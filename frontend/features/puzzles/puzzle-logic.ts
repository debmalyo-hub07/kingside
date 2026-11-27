// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type GameTree,
  type MoveNode,
  nodesAlongPath,
  positionFromFen,
  uciLineToSan,
} from "@kingside/chess-core";
import type { Key } from "chessground/types";

export interface PuzzleHistoryStep {
  /** 1-based step index along the played line (1 = opponent setup move, 2+ = solver & reply moves). */
  index: number;
  fen: string;
  san: string;
  uci: string;
  color: "white" | "black";
  fullmoves: number;
  isSetup: boolean;
}

/** Compares two UCI moves in the same position by SAN (accepts e.g. castling/promo equivalents). */
export function samePuzzleMove(fen: string, a: string, b: string): boolean {
  const [sa] = uciLineToSan(fen, [a]);
  const [sb] = uciLineToSan(fen, [b]);
  return sa !== undefined && sa === sb;
}

/** Returns only the starting square of the expected solution move for a non-failing progressive Hint. */
export function puzzleHintSquare(moves: readonly string[], step: number): Key | null {
  const expected = moves[step];
  if (!expected || expected.length < 2) return null;
  return expected.slice(0, 2) as Key;
}

export type PuzzleAttemptOutcome =
  | { kind: "wrong"; mistakes: number; status: "wrong"; reportClean: false }
  | { kind: "complete"; status: "solved" | "failed"; reportClean: boolean }
  | { kind: "reply"; nextStep: number; replyUci: string };

/** Evaluates a legal solver move against the puzzle line (any immediate checkmate also solves). */
export function evaluatePuzzleAttempt(params: {
  fen: string;
  expected: string;
  played: string;
  afterFen: string;
  currentMistakes: number;
  nextReply: string | undefined;
  step: number;
}): PuzzleAttemptOutcome {
  const { fen, expected, played, afterFen, currentMistakes, nextReply, step } = params;
  const correct = samePuzzleMove(fen, played, expected) || positionFromFen(afterFen).isCheckmate();
  if (!correct) {
    return {
      kind: "wrong",
      mistakes: currentMistakes + 1,
      status: "wrong",
      reportClean: false,
    };
  }
  if (!nextReply || positionFromFen(afterFen).isCheckmate()) {
    return {
      kind: "complete",
      status: currentMistakes > 0 ? "failed" : "solved",
      reportClean: currentMistakes === 0,
    };
  }
  return {
    kind: "reply",
    nextStep: step + 1,
    replyUci: nextReply,
  };
}

/** Builds structured move steps from the current puzzle tree path. */
export function buildPuzzleHistory(tree: GameTree | null, path: readonly string[]): PuzzleHistoryStep[] {
  if (!tree || path.length === 0) return [];
  const nodes = nodesAlongPath(tree, [...path]);
  const steps: PuzzleHistoryStep[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    if (!prev || !curr) continue;
    const before = positionFromFen(prev.fen);
    steps.push({
      index: i,
      fen: curr.fen,
      san: curr.san ?? curr.uci ?? "",
      uci: curr.uci ?? "",
      color: before.turn,
      fullmoves: before.fullmoves,
      isSetup: i === 1,
    });
  }
  return steps;
}

/** Resolves the displayed puzzle node & step index without mutating the underlying tree or path. */
export function resolvePuzzleStep(
  tree: GameTree | null,
  path: readonly string[],
  fallbackFen: string,
  viewStep: number | null,
): {
  liveStep: number;
  effectiveStep: number;
  viewingHistory: boolean;
  liveNode: MoveNode | undefined;
  shownNode: MoveNode | undefined;
  liveFen: string;
  shownFen: string;
} {
  const nodes = tree ? nodesAlongPath(tree, [...path]) : [];
  const liveStep = Math.max(0, nodes.length - 1);
  const effectiveStep = viewStep === null ? liveStep : Math.max(0, Math.min(viewStep, liveStep));
  const viewingHistory = effectiveStep < liveStep;
  const liveNode = nodes[liveStep];
  const shownNode = nodes[effectiveStep];
  return {
    liveStep,
    effectiveStep,
    viewingHistory,
    liveNode,
    shownNode,
    liveFen: liveNode?.fen ?? fallbackFen,
    shownFen: shownNode?.fen ?? fallbackFen,
  };
}
