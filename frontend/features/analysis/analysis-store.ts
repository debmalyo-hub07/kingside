// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  addMove,
  createTree,
  deleteFrom,
  type GameTree,
  type MoveNode,
  mainlineFrom,
  nodeAtPath,
  promoteVariation,
  treeFromPgn,
} from "@kingside/chess-core";
import { create } from "zustand";

type Color = "white" | "black";

interface AnalysisStore {
  tree: GameTree;
  path: string[];
  /** Bumped on every in-place tree mutation so subscribers re-render. */
  version: number;
  orientation: Color;
  /** Replaces the game. Throws InvalidPositionError on bad input. */
  loadFen: (fen: string) => void;
  loadPgn: (pgn: string) => void;
  playMove: (uci: string) => boolean;
  goTo: (path: string[]) => void;
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  flip: () => void;
  promote: (path: string[]) => void;
  remove: (path: string[]) => void;
}

export const useAnalysis = create<AnalysisStore>()((set, get) => ({
  tree: createTree(),
  path: [],
  version: 0,
  orientation: "white",
  loadFen: (fen) => {
    const tree = createTree(fen);
    set((s) => ({ tree, path: [], version: s.version + 1 }));
  },
  loadPgn: (pgn) => {
    const tree = treeFromPgn(pgn);
    set((s) => ({ tree, path: [], version: s.version + 1 }));
  },
  playMove: (uci) => {
    const { tree, path } = get();
    const next = addMove(tree, path, uci);
    if (!next) return false;
    set((s) => ({ path: next, version: s.version + 1 }));
    return true;
  },
  goTo: (path) => set({ path }),
  next: () => {
    const { tree, path } = get();
    const child = nodeAtPath(tree, path)?.children[0];
    if (child) set({ path: [...path, child.id] });
  },
  prev: () => set((s) => ({ path: s.path.slice(0, -1) })),
  first: () => set({ path: [] }),
  last: () => set((s) => ({ path: mainlineFrom(s.tree, s.path) })),
  flip: () => set((s) => ({ orientation: s.orientation === "white" ? "black" : "white" })),
  promote: (path) => {
    promoteVariation(get().tree, path);
    set((s) => ({ version: s.version + 1 }));
  },
  remove: (path) => {
    const { tree, path: current } = get();
    const parent = deleteFrom(tree, path);
    const stillValid = current.length >= path.length && path.every((id, i) => current[i] === id);
    set((s) => ({ path: stillValid ? parent : s.path, version: s.version + 1 }));
  },
}));

export function useCurrentNode(): MoveNode {
  return useAnalysis((s) => nodeAtPath(s.tree, s.path) ?? s.tree.root);
}
