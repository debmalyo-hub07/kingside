// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  addMove,
  botById,
  createTree,
  type GameOver,
  type GameTree,
  gameStatus,
  type MoveNode,
  nodeAtPath,
  nodesAlongPath,
  positionFromFen,
  treeFromPgn,
  treeToPgn,
} from "@kingside/chess-core";
import { create } from "zustand";
import { saveGame } from "@/lib/local-db";
import { playSound } from "@/lib/sounds";

type Color = "white" | "black";

const SESSION_STORAGE_KEY = "kingside:play-session:v1";

export interface TimeControl {
  id: string;
  label: string;
  /** null = untimed. */
  baseMs: number | null;
  incMs: number;
}

export const TIME_CONTROLS: TimeControl[] = [
  { id: "none", label: "No clock", baseMs: null, incMs: 0 },
  { id: "3+2", label: "3 + 2", baseMs: 180_000, incMs: 2_000 },
  { id: "5+3", label: "5 + 3", baseMs: 300_000, incMs: 3_000 },
  { id: "10+0", label: "10 + 0", baseMs: 600_000, incMs: 0 },
  { id: "15+10", label: "15 + 10", baseMs: 900_000, incMs: 10_000 },
];

export interface PlayOver extends Omit<GameOver, "reason"> {
  reason: GameOver["reason"] | "resignation" | "timeout";
}

interface PersistedPlaySession {
  stage: "setup" | "playing" | "over";
  botId: string;
  playerColor: Color;
  tcId: string;
  initialFen: string | null;
  pgn: string;
  pathIndices: number[];
  clocks: Record<Color, number>;
  over: PlayOver | null;
  takebacks: number;
  hints: number;
  viewPly: number | null;
}

function getPathIndices(tree: GameTree, path: readonly string[]): number[] {
  const indices: number[] = [];
  let cur: MoveNode = tree.root;
  for (const id of path) {
    const idx = cur.children.findIndex((c) => c.id === id);
    if (idx < 0) break;
    indices.push(idx);
    const next = cur.children[idx];
    if (!next) break;
    cur = next;
  }
  return indices;
}

function restorePathFromIndices(tree: GameTree, indices: readonly number[]): string[] {
  const path: string[] = [];
  let cur: MoveNode = tree.root;
  for (const idx of indices) {
    const next = cur.children[idx];
    if (!next) break;
    path.push(next.id);
    cur = next;
  }
  return path;
}

function writePlaySession(state: {
  stage: "setup" | "playing" | "over";
  botId: string;
  playerColor: Color;
  tc: TimeControl;
  initialFen: string | null;
  tree: GameTree;
  path: string[];
  clocks: Record<Color, number>;
  over: PlayOver | null;
  takebacks: number;
  hints: number;
  viewPly: number | null;
}): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const payload: PersistedPlaySession = {
      stage: state.stage,
      botId: state.botId,
      playerColor: state.playerColor,
      tcId: state.tc.id,
      initialFen: state.initialFen,
      pgn: state.stage === "setup" ? "" : treeToPgn(state.tree),
      pathIndices: state.stage === "setup" ? [] : getPathIndices(state.tree, state.path),
      clocks: state.clocks,
      over: state.over,
      takebacks: state.takebacks,
      hints: state.hints,
      viewPly: state.viewPly,
    };
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore unavailable or quota-exceeded sessionStorage.
  }
}

function readPlaySession(): PersistedPlaySession | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPlaySession>;
    if (!parsed || typeof parsed !== "object") return null;
    const stage = parsed.stage === "playing" || parsed.stage === "over" ? parsed.stage : "setup";
    return {
      stage,
      botId: typeof parsed.botId === "string" ? parsed.botId : "milo",
      playerColor: parsed.playerColor === "black" ? "black" : "white",
      tcId: typeof parsed.tcId === "string" ? parsed.tcId : "none",
      initialFen: typeof parsed.initialFen === "string" ? parsed.initialFen : null,
      pgn: typeof parsed.pgn === "string" ? parsed.pgn : "",
      pathIndices: Array.isArray(parsed.pathIndices) ? parsed.pathIndices : [],
      clocks:
        parsed.clocks && typeof parsed.clocks.white === "number" && typeof parsed.clocks.black === "number"
          ? { white: parsed.clocks.white, black: parsed.clocks.black }
          : { white: 0, black: 0 },
      over: parsed.over && typeof parsed.over === "object" ? parsed.over : null,
      takebacks: typeof parsed.takebacks === "number" ? parsed.takebacks : 0,
      hints: typeof parsed.hints === "number" ? parsed.hints : 0,
      viewPly: typeof parsed.viewPly === "number" ? parsed.viewPly : null,
    };
  } catch {
    return null;
  }
}

export function clearPlaySessionStorage(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface PlayStore {
  stage: "setup" | "playing" | "over";
  botId: string;
  playerColor: Color;
  tc: TimeControl;
  initialFen: string | null;
  tree: GameTree;
  path: string[];
  clocks: Record<Color, number>;
  /** When the side to move started thinking (ms epoch), null when untimed, paused on reload, or over. */
  turnStartedAt: number | null;
  over: PlayOver | null;
  takebacks: number;
  hints: number;
  viewPly: number | null;
  hasSession: boolean;
  setBot: (id: string) => void;
  setTimeControl: (tc: TimeControl) => void;
  setInitialFen: (fen: string | null) => void;
  setViewPly: (ply: number | null) => void;
  restoreSession: () => boolean;
  start: (color: Color | "random") => void;
  /** Plays a move for the side to move. Returns false if illegal or the game is over. */
  move: (uci: string) => boolean;
  takeback: () => void;
  resign: () => void;
  flag: (color: Color) => void;
  useHint: () => void;
  newGame: () => void;
}

function finish(state: PlayStore, over: PlayOver): Partial<PlayStore> {
  const bot = botById(state.botId);
  const you = "You";
  state.tree.headers.set("Result", over.result);
  state.tree.headers.set("Termination", over.reason);
  const white = state.playerColor === "white" ? you : (bot?.name ?? "Bot");
  const black = state.playerColor === "black" ? you : (bot?.name ?? "Bot");
  // A game with no moves (e.g. instant resignation) is not worth keeping.
  if (state.path.length > 0)
    void saveGame({
      pgn: treeToPgn(state.tree),
      white,
      black,
      result: over.result,
      source: "bot",
      botId: state.botId,
      playedAt: Date.now(),
    });
  playSound("gameEnd");
  return { stage: "over", over, turnStartedAt: null };
}

export const usePlay = create<PlayStore>()((set, get) => ({
  stage: "setup",
  botId: "milo",
  playerColor: "white",
  tc: TIME_CONTROLS[0] as TimeControl,
  initialFen: null,
  tree: createTree(),
  path: [],
  clocks: { white: 0, black: 0 },
  turnStartedAt: null,
  over: null,
  takebacks: 0,
  hints: 0,
  viewPly: null,
  hasSession: false,
  setBot: (botId) => {
    set({ botId, hasSession: true });
    writePlaySession({ ...get(), botId });
  },
  setTimeControl: (tc) => {
    set({ tc, hasSession: true });
    writePlaySession({ ...get(), tc });
  },
  setInitialFen: (fen) => {
    if (!fen) {
      set({ initialFen: null });
      if (get().hasSession) writePlaySession({ ...get(), initialFen: null });
      return;
    }
    try {
      const pos = positionFromFen(fen);
      if (pos.isEnd()) {
        set({ initialFen: null });
        return;
      }
      set({
        stage: "setup",
        over: null,
        path: [],
        initialFen: fen,
        turnStartedAt: null,
        viewPly: null,
        hasSession: true,
      });
      writePlaySession(get());
    } catch {
      set({ initialFen: null });
    }
  },
  setViewPly: (viewPly) => {
    set({ viewPly });
    if (get().hasSession) writePlaySession({ ...get(), viewPly });
  },
  restoreSession: () => {
    const saved = readPlaySession();
    if (!saved) {
      set({ hasSession: true });
      return false;
    }
    const bot = botById(saved.botId);
    const tc = TIME_CONTROLS.find((c) => c.id === saved.tcId) ?? (TIME_CONTROLS[0] as TimeControl);
    if (saved.stage === "setup" || !saved.pgn) {
      set({
        stage: "setup",
        botId: bot ? bot.id : "milo",
        playerColor: saved.playerColor,
        tc,
        initialFen: saved.initialFen,
        tree: createTree(),
        path: [],
        clocks: { white: 0, black: 0 },
        turnStartedAt: null,
        over: null,
        takebacks: 0,
        hints: 0,
        viewPly: null,
        hasSession: true,
      });
      return true;
    }
    try {
      const tree = treeFromPgn(saved.pgn);
      const path = restorePathFromIndices(tree, saved.pathIndices);
      set({
        stage: saved.stage,
        botId: bot ? bot.id : "milo",
        playerColor: saved.playerColor,
        tc,
        initialFen: saved.initialFen,
        tree,
        path,
        clocks: saved.clocks,
        // Pause clock across page reloads so timed bot games never flag on browser refresh.
        turnStartedAt: null,
        over: saved.stage === "over" ? saved.over : null,
        takebacks: saved.takebacks,
        hints: saved.hints,
        viewPly: saved.viewPly,
        hasSession: true,
      });
      return true;
    } catch {
      set({ hasSession: true });
      return false;
    }
  },
  start: (choice) => {
    const color: Color = choice === "random" ? (Math.random() < 0.5 ? "white" : "black") : choice;
    const { botId, tc, initialFen } = get();
    const bot = botById(botId);
    let tree: GameTree;
    try {
      tree = initialFen ? createTree(initialFen) : createTree();
    } catch {
      tree = createTree();
    }
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    tree.headers.set("Event", `Kingside: vs ${bot?.name ?? "bot"}`);
    tree.headers.set("Site", "Kingside");
    tree.headers.set("Date", date);
    tree.headers.set("White", color === "white" ? "You" : (bot?.name ?? "Bot"));
    tree.headers.set("Black", color === "black" ? "You" : (bot?.name ?? "Bot"));
    if (bot?.level.elo) {
      tree.headers.set(color === "white" ? "BlackElo" : "WhiteElo", String(bot.level.elo));
    }
    tree.headers.set("Result", "*");
    if (tc.baseMs) tree.headers.set("TimeControl", `${tc.baseMs / 1000}+${tc.incMs / 1000}`);
    playSound("gameStart");
    set({
      stage: "playing",
      playerColor: color,
      tree,
      path: [],
      over: null,
      takebacks: 0,
      hints: 0,
      viewPly: null,
      clocks: { white: tc.baseMs ?? 0, black: tc.baseMs ?? 0 },
      turnStartedAt: tc.baseMs ? Date.now() : null,
      hasSession: true,
    });
    writePlaySession(get());
  },
  move: (uci) => {
    const s = get();
    if (s.stage !== "playing") return false;
    const node = nodeAtPath(s.tree, s.path);
    if (!node) return false;
    const mover = positionFromFen(node.fen).turn;
    const next = addMove(s.tree, s.path, uci);
    if (!next) return false;
    const clocks = { ...s.clocks };
    if (s.tc.baseMs) {
      const elapsed = s.turnStartedAt ? Date.now() - s.turnStartedAt : 0;
      clocks[mover] = clocks[mover] - elapsed + s.tc.incMs;
    }
    const fens = nodesAlongPath(s.tree, next).map((n) => n.fen);
    const ended = gameStatus(fens);
    const update: Partial<PlayStore> = {
      path: next,
      clocks,
      ...(mover === s.playerColor ? { viewPly: null } : {}),
      turnStartedAt: s.tc.baseMs ? Date.now() : null,
      hasSession: true,
    };
    set(update);
    if (ended) set(finish({ ...get() }, ended));
    writePlaySession(get());
    return true;
  },
  takeback: () => {
    const s = get();
    if (s.stage !== "playing" || s.path.length === 0) return;
    const node = nodeAtPath(s.tree, s.path);
    const toMove = node ? positionFromFen(node.fen).turn : s.playerColor;
    // On the player's turn undo bot reply + own move; otherwise just the own move.
    const back = toMove === s.playerColor ? 2 : 1;
    const keep = Math.max(0, s.path.length - back);
    if (keep === s.path.length) return;
    const parentPath = s.path.slice(0, keep);
    const parent = nodeAtPath(s.tree, parentPath);
    if (parent) parent.children = [];
    set({
      path: parentPath,
      takebacks: s.takebacks + 1,
      viewPly: null,
      turnStartedAt: s.tc.baseMs ? Date.now() : null,
      hasSession: true,
    });
    writePlaySession(get());
  },
  resign: () => {
    const s = get();
    if (s.stage !== "playing") return;
    set(finish(s, { result: s.playerColor === "white" ? "0-1" : "1-0", reason: "resignation" }));
    writePlaySession(get());
  },
  flag: (color) => {
    const s = get();
    if (s.stage !== "playing") return;
    set(finish(s, { result: color === "white" ? "0-1" : "1-0", reason: "timeout" }));
    writePlaySession(get());
  },
  useHint: () => {
    set((s) => ({ hints: s.hints + 1, hasSession: true }));
    writePlaySession(get());
  },
  newGame: () => {
    set({
      stage: "setup",
      over: null,
      initialFen: null,
      path: [],
      tree: createTree(),
      turnStartedAt: null,
      viewPly: null,
      hasSession: true,
    });
    writePlaySession(get());
  },
}));
