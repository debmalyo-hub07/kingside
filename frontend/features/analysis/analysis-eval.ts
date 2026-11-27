// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Score } from "@kingside/chess-core";
import type { EngineSnapshot } from "@/engine/stockfish-engine";
import type { EvalEntry } from "./live-classification";

/** Minimum search depth before live engine eval drives the EvalBar (prevents early horizon spikes). */
export const ANALYSIS_MIN_EVAL_DEPTH = 6;
/** Max duration (ms) to hold the previous EvalBar score while awaiting cache or settled depth >= 6. */
export const ANALYSIS_HOLD_MS = 450;

export interface HeldEval {
  score: Score | undefined;
  whiteWin: number | undefined;
}

export interface AnalysisEvalBarResolution {
  score: Score | undefined;
  whiteWin: number | undefined;
  settled: boolean;
}

export function resolveAnalysisEvalBar({
  gameOverWhiteWin,
  snapshot,
  cachedEntry,
  reviewWhiteWin,
  engineEnabled,
  heldEval,
  holdExpired,
}: {
  gameOverWhiteWin: number | undefined;
  snapshot: Pick<EngineSnapshot, "depth" | "done" | "lines"> | null;
  cachedEntry: EvalEntry | undefined;
  reviewWhiteWin: number | undefined;
  engineEnabled: boolean;
  heldEval: HeldEval | null;
  holdExpired: boolean;
}): AnalysisEvalBarResolution {
  if (gameOverWhiteWin !== undefined) {
    return { score: undefined, whiteWin: gameOverWhiteWin, settled: true };
  }

  const snapScore = snapshot?.lines[0]?.score;
  if (snapScore && ((snapshot?.depth ?? 0) >= ANALYSIS_MIN_EVAL_DEPTH || snapshot?.done)) {
    return { score: snapScore, whiteWin: undefined, settled: true };
  }

  const cachedScore = cachedEntry?.lines[0]?.score;
  if (cachedScore && (cachedEntry.depth >= ANALYSIS_MIN_EVAL_DEPTH || !engineEnabled)) {
    return { score: cachedScore, whiteWin: undefined, settled: true };
  }

  if (typeof reviewWhiteWin === "number") {
    return { score: undefined, whiteWin: reviewWhiteWin, settled: true };
  }

  if (engineEnabled && !holdExpired && heldEval) {
    return { score: heldEval.score, whiteWin: heldEval.whiteWin, settled: false };
  }

  if (snapScore) {
    return { score: snapScore, whiteWin: undefined, settled: false };
  }

  if (cachedScore) {
    return { score: cachedScore, whiteWin: undefined, settled: false };
  }

  return { score: undefined, whiteWin: undefined, settled: false };
}
