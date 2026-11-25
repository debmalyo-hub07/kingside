// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  addMove,
  botById,
  createTree,
  type GameOver,
  type GameTree,
  gameStatus,
  nodeAtPath,
  nodesAlongPath,
  positionFromFen,
  treeToPgn,
} from "@kingside/chess-core";
import { create } from "zustand";
import { saveGame } from "@/lib/local-db";
import { playSound } from "@/lib/sounds";

type Color = "white" | "black";

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

interface PlayStore {
  stage: "setup" | "playing" | "over";
  botId: string;
  playerColor: Color;
  tc: TimeControl;
  tree: GameTree;
  path: string[];
  clocks: Record<Color, number>;
  /** When the side to move started thinking (ms epoch), null when untimed or over. */
  turnStartedAt: number | null;
  over: PlayOver | null;
  takebacks: number;
  hints: number;
  setBot: (id: string) => void;
  setTimeControl: (tc: TimeControl) => void;
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
  tree: createTree(),
  path: [],
  clocks: { white: 0, black: 0 },
  turnStartedAt: null,
  over: null,
  takebacks: 0,
  hints: 0,
  setBot: (botId) => set({ botId }),
  setTimeControl: (tc) => set({ tc }),
  start: (choice) => {
    const color: Color = choice === "random" ? (Math.random() < 0.5 ? "white" : "black") : choice;
    const { botId, tc } = get();
    const bot = botById(botId);
    const tree = createTree();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    tree.headers.set("Event", `Kingside: vs ${bot?.name ?? "bot"}`);
    tree.headers.set("Site", "Kingside");
    tree.headers.set("Date", date);
    tree.headers.set("White", color === "white" ? "You" : (bot?.name ?? "Bot"));
    tree.headers.set("Black", color === "black" ? "You" : (bot?.name ?? "Bot"));
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
      clocks: { white: tc.baseMs ?? 0, black: tc.baseMs ?? 0 },
      turnStartedAt: tc.baseMs ? Date.now() : null,
    });
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
    if (s.tc.baseMs && s.turnStartedAt) {
      clocks[mover] = clocks[mover] - (Date.now() - s.turnStartedAt) + s.tc.incMs;
    }
    const fens = nodesAlongPath(s.tree, next).map((n) => n.fen);
    const ended = gameStatus(fens);
    const update: Partial<PlayStore> = {
      path: next,
      clocks,
      turnStartedAt: s.tc.baseMs ? Date.now() : null,
    };
    set(update);
    if (ended) set(finish({ ...get() }, ended));
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
    set({ path: parentPath, takebacks: s.takebacks + 1, turnStartedAt: s.tc.baseMs ? Date.now() : null });
  },
  resign: () => {
    const s = get();
    if (s.stage !== "playing") return;
    set(finish(s, { result: s.playerColor === "white" ? "0-1" : "1-0", reason: "resignation" }));
  },
  flag: (color) => {
    const s = get();
    if (s.stage !== "playing") return;
    set(finish(s, { result: color === "white" ? "0-1" : "1-0", reason: "timeout" }));
  },
  useHint: () => set((s) => ({ hints: s.hints + 1 })),
  newGame: () => set({ stage: "setup", over: null, path: [], tree: createTree(), turnStartedAt: null }),
}));
