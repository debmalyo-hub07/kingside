// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  addMove,
  createTree,
  deleteFrom,
  type EngineLine,
  type GameTree,
  type MoveClass,
  type MoveNode,
  mainlineFrom,
  nodeAtPath,
  promoteToMainline,
  promoteVariation,
  setNodeComment,
  toggleNodeNag,
  treeFromPgn,
  treeToPgn,
} from "@kingside/chess-core";
import { create } from "zustand";
import { collectTreeNodes, epdOf } from "./live-classification";

type Color = "white" | "black";
export type AnalysisWorkspace = "analysis" | "openings" | "endgames";

const WORKSPACES: readonly AnalysisWorkspace[] = ["analysis", "openings", "endgames"];
const sessionStorageKey = (ws: AnalysisWorkspace) => `kingside:analysis-session:v1:${ws}`;

export interface LoadFenOptions {
  persist?: boolean;
  sessionKey?: AnalysisWorkspace;
}

export interface LoadPgnOptions {
  ply?: number;
  orientation?: Color;
  classes?: readonly MoveClass[];
  whiteWin?: readonly number[];
  evalLines?: readonly { fen: string; lines: EngineLine[] }[];
  previewLine?: readonly string[];
  persist?: boolean;
  sessionKey?: AnalysisWorkspace;
}

interface PersistedAnalysisSession {
  pgn: string;
  pathIndices: number[];
  orientation: Color;
  reviewClasses: Record<string, MoveClass>;
  reviewWhiteWin: Record<string, number>;
}

function buildNodeIndexMap(tree: GameTree): {
  idToIndices: Map<string, number[]>;
  indicesToId: Map<string, string>;
} {
  const idToIndices = new Map<string, number[]>();
  const indicesToId = new Map<string, string>();
  const visit = (node: MoveNode, indices: number[]) => {
    idToIndices.set(node.id, indices);
    indicesToId.set(indices.join("."), node.id);
    node.children.forEach((child, i) => {
      visit(child, [...indices, i]);
    });
  };
  visit(tree.root, []);
  return { idToIndices, indicesToId };
}

function writeSession(state: {
  sessionKey: AnalysisWorkspace;
  tree: GameTree;
  path: string[];
  orientation: Color;
  reviewClasses: Record<string, MoveClass>;
  reviewWhiteWin: Record<string, number>;
}): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const { idToIndices } = buildNodeIndexMap(state.tree);
    const activeId = state.path[state.path.length - 1] ?? state.tree.root.id;
    const pathIndices = idToIndices.get(activeId) ?? [];
    const reviewClasses: Record<string, MoveClass> = {};
    for (const [id, cls] of Object.entries(state.reviewClasses)) {
      const idx = idToIndices.get(id);
      if (idx) reviewClasses[idx.join(".")] = cls;
    }
    const reviewWhiteWin: Record<string, number> = {};
    for (const [id, w] of Object.entries(state.reviewWhiteWin)) {
      const idx = idToIndices.get(id);
      if (idx) reviewWhiteWin[idx.join(".")] = w;
    }
    const payload: PersistedAnalysisSession = {
      pgn: treeToPgn(state.tree),
      pathIndices,
      orientation: state.orientation,
      reviewClasses,
      reviewWhiteWin,
    };
    window.sessionStorage.setItem(sessionStorageKey(state.sessionKey), JSON.stringify(payload));
  } catch {
    // Ignore unavailable or quota-exceeded sessionStorage (private mode, sandboxed frames).
  }
}

function readSession(ws: AnalysisWorkspace): PersistedAnalysisSession | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(sessionStorageKey(ws));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAnalysisSession>;
    if (!parsed || typeof parsed.pgn !== "string") return null;
    return {
      pgn: parsed.pgn,
      pathIndices: Array.isArray(parsed.pathIndices) ? parsed.pathIndices : [],
      orientation: parsed.orientation === "black" ? "black" : "white",
      reviewClasses:
        parsed.reviewClasses && typeof parsed.reviewClasses === "object" ? parsed.reviewClasses : {},
      reviewWhiteWin:
        parsed.reviewWhiteWin && typeof parsed.reviewWhiteWin === "object" ? parsed.reviewWhiteWin : {},
    };
  } catch {
    return null;
  }
}

export function clearAnalysisSessionStorage(ws?: AnalysisWorkspace): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    if (ws) {
      window.sessionStorage.removeItem(sessionStorageKey(ws));
    } else {
      for (const key of WORKSPACES) {
        window.sessionStorage.removeItem(sessionStorageKey(key));
      }
    }
  } catch {
    // ignore
  }
}

export interface ResetAnalysisOptions {
  defaultFen?: string | undefined;
  persist?: boolean | undefined;
  sessionKey?: AnalysisWorkspace | undefined;
}

interface AnalysisStore {
  tree: GameTree;
  path: string[];
  /** Bumped on every in-place tree mutation so subscribers re-render. */
  version: number;
  orientation: Color;
  /** Anchored Match Analysis move classifications keyed by MoveNode.id. */
  reviewClasses: Record<string, MoveClass>;
  /** Optional fallback White win % series (e.g. from /g/[id] shared games) keyed by MoveNode.id. */
  reviewWhiteWin: Record<string, number>;
  /** Transient pre-loaded engine lines (from /review positions) keyed by EPD. */
  initialEvals: Record<string, EngineLine[]>;
  /** Active workspace namespace for isolated sessionStorage persistence. */
  sessionKey: AnalysisWorkspace;
  /** True when the active store state belongs to a persisted workspace session. */
  hasPersistedSession: boolean;
  /** Replaces the game. Throws InvalidPositionError on bad input. */
  loadFen: (fen: string, opts?: LoadFenOptions) => void;
  loadPgn: (pgn: string, opts?: LoadPgnOptions) => void;
  reset: (opts?: ResetAnalysisOptions) => void;
  restoreSession: (sessionKey?: AnalysisWorkspace) => boolean;
  playMove: (uci: string) => boolean;
  goTo: (path: string[]) => void;
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  flip: () => void;
  promote: (path: string[]) => void;
  makeMainline: (path: string[]) => void;
  setComment: (path: string[], comment: string) => void;
  toggleNag: (path: string[], nag: number) => void;
  remove: (path: string[]) => void;
}

export const useAnalysis = create<AnalysisStore>()((set, get) => ({
  tree: createTree(),
  path: [],
  version: 0,
  orientation: "white",
  reviewClasses: {},
  reviewWhiteWin: {},
  initialEvals: {},
  sessionKey: "analysis",
  hasPersistedSession: false,
  loadFen: (fen, opts) => {
    const persist = opts?.persist ?? true;
    const sessionKey = opts?.sessionKey ?? "analysis";
    const tree = createTree(fen);
    const orientation = get().orientation;
    const reviewClasses: Record<string, MoveClass> = {};
    const reviewWhiteWin: Record<string, number> = {};
    set((s) => ({
      tree,
      path: [],
      reviewClasses,
      reviewWhiteWin,
      initialEvals: {},
      sessionKey,
      hasPersistedSession: persist,
      version: s.version + 1,
    }));
    if (persist) writeSession({ sessionKey, tree, path: [], orientation, reviewClasses, reviewWhiteWin });
  },
  loadPgn: (pgn, opts) => {
    const persist = opts?.persist ?? true;
    const sessionKey = opts?.sessionKey ?? "analysis";
    const tree = treeFromPgn(pgn);
    const mainline = mainlineFrom(tree);
    const targetPly = opts?.ply !== undefined ? Math.max(0, Math.min(opts.ply, mainline.length)) : 0;
    let path = mainline.slice(0, targetPly);
    if (opts?.previewLine?.length) {
      for (const uci of opts.previewLine) {
        const next = addMove(tree, path, uci);
        if (!next) break;
        path = next;
      }
    }
    const reviewClasses: Record<string, MoveClass> = {};
    if (opts?.classes) {
      for (let i = 0; i < mainline.length && i < opts.classes.length; i++) {
        const id = mainline[i];
        const cls = opts.classes[i];
        if (id && cls) reviewClasses[id] = cls;
      }
    }
    const reviewWhiteWin: Record<string, number> = {};
    if (opts?.whiteWin) {
      const ids = [tree.root.id, ...mainline];
      for (let i = 0; i < ids.length && i < opts.whiteWin.length; i++) {
        const id = ids[i];
        const w = opts.whiteWin[i];
        if (id && typeof w === "number") reviewWhiteWin[id] = w;
      }
    }
    const initialEvals: Record<string, EngineLine[]> = {};
    if (opts?.evalLines) {
      for (const pos of opts.evalLines) {
        if (pos.lines.length > 0) {
          initialEvals[epdOf(pos.fen)] = pos.lines;
        }
      }
    }
    const orientation = opts?.orientation ?? get().orientation;
    set((s) => ({
      tree,
      path,
      orientation,
      reviewClasses,
      reviewWhiteWin,
      initialEvals,
      sessionKey,
      hasPersistedSession: persist,
      version: s.version + 1,
    }));
    if (persist) writeSession({ sessionKey, tree, path, orientation, reviewClasses, reviewWhiteWin });
  },
  reset: (opts) => {
    const state = get();
    const sessionKey = opts?.sessionKey ?? state.sessionKey;
    const persist = opts?.persist ?? state.hasPersistedSession;
    const tree = opts?.defaultFen ? createTree(opts.defaultFen) : createTree();
    set((s) => ({
      tree,
      path: [],
      orientation: "white",
      reviewClasses: {},
      reviewWhiteWin: {},
      initialEvals: {},
      sessionKey,
      hasPersistedSession: persist,
      version: s.version + 1,
    }));
    if (persist) clearAnalysisSessionStorage(sessionKey);
  },
  restoreSession: (sessionKey = "analysis") => {
    const saved = readSession(sessionKey);
    if (!saved) {
      set({ sessionKey, hasPersistedSession: true });
      return false;
    }
    try {
      const tree = treeFromPgn(saved.pgn);
      const path: string[] = [];
      let cur = tree.root;
      for (const idx of saved.pathIndices) {
        const next = cur.children[idx];
        if (!next) break;
        path.push(next.id);
        cur = next;
      }
      const { indicesToId } = buildNodeIndexMap(tree);
      const reviewClasses: Record<string, MoveClass> = {};
      for (const [idxKey, cls] of Object.entries(saved.reviewClasses)) {
        const id = indicesToId.get(idxKey);
        if (id) reviewClasses[id] = cls;
      }
      const reviewWhiteWin: Record<string, number> = {};
      for (const [idxKey, w] of Object.entries(saved.reviewWhiteWin)) {
        const id = indicesToId.get(idxKey);
        if (id && typeof w === "number") reviewWhiteWin[id] = w;
      }
      set((s) => ({
        tree,
        path,
        orientation: saved.orientation,
        reviewClasses,
        reviewWhiteWin,
        initialEvals: {},
        sessionKey,
        hasPersistedSession: true,
        version: s.version + 1,
      }));
      return true;
    } catch {
      set({ sessionKey, hasPersistedSession: true });
      return false;
    }
  },
  playMove: (uci) => {
    const { sessionKey, tree, path, orientation, reviewClasses, reviewWhiteWin, hasPersistedSession } = get();
    const next = addMove(tree, path, uci);
    if (!next) return false;
    set((s) => ({ path: next, version: s.version + 1 }));
    if (hasPersistedSession)
      writeSession({ sessionKey, tree, path: next, orientation, reviewClasses, reviewWhiteWin });
    return true;
  },
  goTo: (path) => {
    set({ path });
    const { sessionKey, tree, orientation, reviewClasses, reviewWhiteWin, hasPersistedSession } = get();
    if (hasPersistedSession)
      writeSession({ sessionKey, tree, path, orientation, reviewClasses, reviewWhiteWin });
  },
  next: () => {
    const { sessionKey, tree, path, orientation, reviewClasses, reviewWhiteWin, hasPersistedSession } = get();
    const child = nodeAtPath(tree, path)?.children[0];
    if (child) {
      const nextPath = [...path, child.id];
      set({ path: nextPath });
      if (hasPersistedSession) {
        writeSession({ sessionKey, tree, path: nextPath, orientation, reviewClasses, reviewWhiteWin });
      }
    }
  },
  prev: () => {
    const { sessionKey, tree, path, orientation, reviewClasses, reviewWhiteWin, hasPersistedSession } = get();
    const nextPath = path.slice(0, -1);
    set({ path: nextPath });
    if (hasPersistedSession)
      writeSession({ sessionKey, tree, path: nextPath, orientation, reviewClasses, reviewWhiteWin });
  },
  first: () => {
    set({ path: [] });
    const { sessionKey, tree, orientation, reviewClasses, reviewWhiteWin, hasPersistedSession } = get();
    if (hasPersistedSession)
      writeSession({ sessionKey, tree, path: [], orientation, reviewClasses, reviewWhiteWin });
  },
  last: () => {
    const { sessionKey, tree, path, orientation, reviewClasses, reviewWhiteWin, hasPersistedSession } = get();
    const nextPath = mainlineFrom(tree, path);
    set({ path: nextPath });
    if (hasPersistedSession)
      writeSession({ sessionKey, tree, path: nextPath, orientation, reviewClasses, reviewWhiteWin });
  },
  flip: () => {
    const { sessionKey, tree, path, orientation, reviewClasses, reviewWhiteWin, hasPersistedSession } = get();
    const nextOrientation: Color = orientation === "white" ? "black" : "white";
    set({ orientation: nextOrientation });
    if (hasPersistedSession) {
      writeSession({ sessionKey, tree, path, orientation: nextOrientation, reviewClasses, reviewWhiteWin });
    }
  },
  promote: (path) => {
    const state = get();
    promoteVariation(state.tree, path);
    set((s) => ({ version: s.version + 1 }));
    if (state.hasPersistedSession) writeSession(state);
  },
  makeMainline: (path) => {
    const state = get();
    promoteToMainline(state.tree, path);
    set((s) => ({ version: s.version + 1 }));
    if (state.hasPersistedSession) writeSession(state);
  },
  setComment: (path, comment) => {
    const state = get();
    setNodeComment(state.tree, path, comment);
    set((s) => ({ version: s.version + 1 }));
    if (state.hasPersistedSession) writeSession(state);
  },
  toggleNag: (path, nag) => {
    const state = get();
    toggleNodeNag(state.tree, path, nag);
    set((s) => ({ version: s.version + 1 }));
    if (state.hasPersistedSession) writeSession(state);
  },
  remove: (path) => {
    const {
      sessionKey,
      tree,
      path: current,
      orientation,
      reviewClasses,
      reviewWhiteWin,
      hasPersistedSession,
    } = get();
    const parent = deleteFrom(tree, path);
    const stillValid = current.length >= path.length && path.every((id, i) => current[i] === id);
    const nextPath = stillValid ? parent : current;
    const remainingIds = new Set(collectTreeNodes(tree.root).map((n) => n.id));
    const prunedClasses: Record<string, MoveClass> = {};
    for (const [id, cls] of Object.entries(reviewClasses)) {
      if (remainingIds.has(id)) prunedClasses[id] = cls;
    }
    const prunedWhiteWin: Record<string, number> = {};
    for (const [id, w] of Object.entries(reviewWhiteWin)) {
      if (remainingIds.has(id)) prunedWhiteWin[id] = w;
    }
    set((s) => ({
      path: nextPath,
      reviewClasses: prunedClasses,
      reviewWhiteWin: prunedWhiteWin,
      version: s.version + 1,
    }));
    if (hasPersistedSession) {
      writeSession({
        sessionKey,
        tree,
        path: nextPath,
        orientation,
        reviewClasses: prunedClasses,
        reviewWhiteWin: prunedWhiteWin,
      });
    }
  },
}));

export function useCurrentNode(): MoveNode {
  return useAnalysis((s) => nodeAtPath(s.tree, s.path) ?? s.tree.root);
}
