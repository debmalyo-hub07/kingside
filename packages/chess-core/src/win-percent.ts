// SPDX-License-Identifier: AGPL-3.0-or-later

import { CP_CLAMP, LABEL_WIN_K, WIN_PERCENT_K } from "./constants";
import type { Color, Score } from "./types";

/** White's win% (0..100) from a White-POV centipawn value. docs/ALGORITHMS.md §2. */
export function winPercentFromCp(cp: number, k: number = WIN_PERCENT_K): number {
  const clamped = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-k * clamped)) - 1);
}

/**
 * White's expected points (0..100) behind move labels, from a White-POV score: same shape as the win %,
 * steeper slope (LABEL_WIN_K). docs/ALGORITHMS.md §2a.
 */
export function labelWinFromScore(score: Score): number {
  if (score.mate !== undefined) return winPercentFromCp(Math.sign(score.mate) * CP_CLAMP, LABEL_WIN_K);
  return winPercentFromCp(score.cp, LABEL_WIN_K);
}

/**
 * White's win% from a White-POV score. Forced mates count as the centipawn cap (±1000 → ~97.5 / ~2.5),
 * matching how Lichess computes accuracy (verified by the golden test). docs/ALGORITHMS.md §2.
 */
export function winPercentFromScore(score: Score): number {
  if (score.mate !== undefined) return winPercentFromCp(Math.sign(score.mate) * CP_CLAMP);
  return winPercentFromCp(score.cp);
}

/** White's win% in a checkmate position (the side to move is mated). */
export function winPercentCheckmated(sideToMove: Color): number {
  return winPercentFromCp(sideToMove === "white" ? -CP_CLAMP : CP_CLAMP);
}

/** Converts White's win% to the given side's win%. */
export function winPercentFor(color: Color, whiteWinPercent: number): number {
  return color === "white" ? whiteWinPercent : 100 - whiteWinPercent;
}
