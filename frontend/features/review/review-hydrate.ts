// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  anchoredPerformance,
  detectPhases,
  estimatePerformance,
  type GameReview,
  MOVE_CLASSES,
  type MoveClass,
  type MoveReview,
  moveAccuracy,
  movePrecision,
  type PlayerSummary,
  positionFromFen,
  type ReviewMove,
  type ReviewPosition,
  reviewGame,
  uciLineToSan,
  winPercentCheckmated,
  winPercentFromScore,
} from "@kingside/chess-core";
import type { SavedReview } from "@/lib/local-db";

const KEY_CLASSES = new Set<MoveClass>(["blunder", "mistake", "miss", "brilliant", "great"]);
const MAX_KEY_MOMENTS = 12;
const KEY_MOMENT_SWING = 15;
const LINE_PLIES = 8;

export interface HydrateReviewInput {
  fens: readonly string[];
  moves: readonly ReviewMove[];
  positions: readonly ReviewPosition[];
  bookPlies: number;
  ratings: { white: number | null; black: number | null };
  timeClass: string | null;
  savedReview?: SavedReview | undefined;
}

function isNonTerminalWithoutLines(fen: string, pos: ReviewPosition | undefined): boolean {
  if (pos && pos.lines.length > 0) return false;
  try {
    return !positionFromFen(fen).isEnd();
  } catch {
    return false;
  }
}

function normalizeCounts(raw: Record<string, number> | undefined): Record<MoveClass, number> {
  return Object.fromEntries(MOVE_CLASSES.map((c) => [c, raw?.[c] ?? 0])) as Record<MoveClass, number>;
}

function fallbackWhiteWinSeries(
  fens: readonly string[],
  positions: readonly ReviewPosition[],
  savedWhiteWin?: readonly number[],
): number[] {
  if (savedWhiteWin && savedWhiteWin.length === fens.length) {
    return [...savedWhiteWin];
  }
  let last = 50;
  return fens.map((fen, i) => {
    try {
      const chess = positionFromFen(fen);
      if (chess.isCheckmate()) {
        last = winPercentCheckmated(chess.turn);
        return last;
      }
      if (chess.isEnd()) {
        last = 50;
        return last;
      }
    } catch {
      return last;
    }
    const best = positions[i]?.lines[0];
    if (best) last = winPercentFromScore(best.score);
    return last;
  });
}

function pickKeyMoments(moves: readonly MoveReview[], lastBookPly: number): number[] {
  const specialAndSwings = moves
    .map((m) => {
      const swing = Math.abs(m.winBefore - m.winAfter);
      const isKeyClass = KEY_CLASSES.has(m.classification);
      if (!isKeyClass && swing < KEY_MOMENT_SWING) return null;
      const priority =
        m.classification === "blunder" || m.classification === "miss"
          ? 3
          : m.classification === "mistake" || m.classification === "brilliant" || m.classification === "great"
            ? 2
            : 1;
      return { ply: m.ply, priority, swing };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.priority - a.priority || b.swing - a.swing || a.ply - b.ply)
    .map((x) => x.ply);

  return [...new Set([...(lastBookPly > 0 ? [lastBookPly] : []), ...specialAndSwings])]
    .slice(0, MAX_KEY_MOMENTS)
    .sort((a, b) => a - b);
}

/**
 * Reconstructs a `GameReview` from cached `db.evals` positions when all non-terminal positions are
 * present, or falls back to `SavedReview` summary + `whiteWin` / `classes` when `db.evals` was pruned.
 * Returns `null` if neither full evals nor a valid `SavedReview` fallback are available.
 */
export function buildHydratedReview({
  fens,
  moves,
  positions,
  bookPlies,
  ratings,
  timeClass,
  savedReview,
}: HydrateReviewInput): GameReview | null {
  if (fens.length !== moves.length + 1) return null;

  const missingEval = fens.some((fen, i) => isNonTerminalWithoutLines(fen, positions[i]));
  if (!missingEval) {
    return reviewGame({
      positions: [...positions],
      moves: [...moves],
      bookPlies,
      ratings,
      timeClass,
    });
  }

  const hasSavedFallback =
    savedReview !== undefined &&
    (savedReview.whiteWin?.length === fens.length || savedReview.classes?.length === moves.length);
  if (!hasSavedFallback || !savedReview) {
    return null;
  }

  const whiteWin = fallbackWhiteWinSeries(fens, positions, savedReview.whiteWin);
  const phases = detectPhases(fens);
  const moveReviews: MoveReview[] = moves.map((move, i) => {
    const before = positions[i] ?? { fen: fens[i] as string, lines: [] };
    const after = positions[i + 1] ?? { fen: fens[i + 1] as string, lines: [] };
    const color = positionFromFen(before.fen).turn;
    const w0 = whiteWin[i] ?? 50;
    const w1 = whiteWin[i + 1] ?? 50;
    const winBefore = color === "white" ? w0 : 100 - w0;
    const winAfter = color === "white" ? w1 : 100 - w1;
    const epLoss = Math.max(0, winBefore - winAfter) / 100;
    const classification = savedReview.classes?.[i] ?? (i < bookPlies ? "book" : "good");
    const bestUci = before.lines[0]?.pv[0];
    const bestLine = before.lines[0] ? uciLineToSan(before.fen, before.lines[0].pv.slice(0, LINE_PLIES)) : [];
    const bestSan = bestLine[0];
    const replyLine = after.lines[0] ? uciLineToSan(after.fen, after.lines[0].pv.slice(0, LINE_PLIES)) : [];
    const scoreBefore = before.lines[0]?.score;
    const scoreAfter = after.lines[0]?.score;
    const depth = Math.max(before.lines[0]?.depth ?? 0, after.lines[0]?.depth ?? 0);

    return {
      ply: i + 1,
      color,
      san: move.san,
      classification,
      accuracy: moveAccuracy(winBefore, winAfter),
      precision: movePrecision(epLoss),
      winBefore,
      winAfter,
      epLoss,
      sacrifice: false,
      ...(bestSan ? { bestSan } : {}),
      ...(bestUci ? { bestUci } : {}),
      ...(bestLine.length ? { bestLine } : {}),
      ...(replyLine.length ? { replyLine } : {}),
      ...(scoreBefore ? { scoreBefore } : {}),
      ...(scoreAfter ? { scoreAfter } : {}),
      ...(depth > 0 ? { depth } : {}),
    };
  });

  const summarize = (side: "white" | "black"): PlayerSummary => {
    const accuracy = savedReview.accuracy[side];
    const ownCount = moveReviews.filter((m) => m.color === side).length;
    const rating = side === "white" ? savedReview.whiteRating : savedReview.blackRating;
    return {
      accuracy,
      precision: savedReview.precision?.[side] ?? null,
      phaseAccuracy: savedReview.phaseAccuracy[side],
      phasePrecision: { opening: null, middlegame: null, endgame: null },
      counts: normalizeCounts(savedReview.counts[side]),
      acpl: savedReview.acpl[side],
      performance: anchoredPerformance(
        estimatePerformance(accuracy, ownCount, savedReview.timeClass),
        rating,
      ),
    };
  };

  let lastBookPly = 0;
  for (const m of moveReviews) {
    if (m.classification !== "book") break;
    lastBookPly = m.ply;
  }

  return {
    moves: moveReviews,
    whiteWin,
    phases,
    white: summarize("white"),
    black: summarize("black"),
    keyMoments: pickKeyMoments(moveReviews, lastBookPly),
    lastBookPly,
  };
}
