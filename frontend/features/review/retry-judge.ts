// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type Color,
  type EngineLine,
  labelWinFromScore,
  positionFromFen,
  type Score,
} from "@kingside/chess-core";

export const RETRY_TOLERANCE = 2;

export type AlternativeVerdict = "correct" | "alsoGood" | "wrong";

/**
 * Evaluates a candidate move in Retry/Drill mode:
 * - Immediate checkmate is accepted ("alsoGood" if not the engine's exact #1 SAN/UCI).
 * - Stalemate, insufficient material, and 50-move draws resolve directly to { cp: 0 } before calling
 *   Stockfish, avoiding the UCI `pv`-less stalemate `info` bug.
 * - Otherwise checks cached `lines` first, then falls back to `evaluateScore()`.
 */
export async function judgeAlternativeMove(opts: {
  afterFen: string;
  uci: string;
  san: string;
  color: Color;
  lines: readonly EngineLine[];
  bestSan?: string;
  bestUci?: string;
  playedUci?: string;
  evaluateScore: () => Promise<Score | undefined>;
  tolerance?: number;
}): Promise<AlternativeVerdict> {
  const {
    afterFen,
    uci,
    san,
    color,
    lines,
    bestSan,
    bestUci,
    playedUci,
    evaluateScore,
    tolerance = RETRY_TOLERANCE,
  } = opts;

  if ((bestUci && uci === bestUci) || (bestSan && san === bestSan)) return "correct";
  if (playedUci && uci === playedUci) return "wrong";

  const afterPos = positionFromFen(afterFen);
  if (afterPos.isCheckmate()) return "alsoGood";

  const isDraw = afterPos.isStalemate() || afterPos.isInsufficientMaterial() || afterPos.halfmoves >= 100;

  let score: Score | undefined = isDraw ? { cp: 0 } : lines.find((l) => l.pv[0] === uci)?.score;

  if (!score && !isDraw) {
    score = await evaluateScore();
  }

  const best = lines[0]?.score;
  if (!best || !score) return "wrong";

  const mover = (w: number) => (color === "white" ? w : 100 - w);
  const loss = mover(labelWinFromScore(best)) - mover(labelWinFromScore(score));
  return loss <= tolerance ? "alsoGood" : "wrong";
}
