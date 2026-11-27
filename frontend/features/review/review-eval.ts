// SPDX-License-Identifier: AGPL-3.0-or-later
// Resolves EvalBar props for ReviewReport, including live line previews (best vs reply).

import type { ReviewPosition, Score } from "@kingside/chess-core";
import type { Preview } from "./coach-card";

export interface EvalBarTarget {
  score: Score | undefined;
  whiteWin: number | undefined;
}

export function resolveReviewEvalBar({
  preview,
  shownIndex,
  before,
  after,
  positions,
  whiteWin,
}: {
  preview: Preview | null;
  shownIndex: number;
  before: ReviewPosition | undefined;
  after: ReviewPosition | undefined;
  positions: readonly ReviewPosition[];
  whiteWin: readonly number[];
}): EvalBarTarget {
  if (preview) {
    const targetPos = preview.line === "best" ? before : after;
    const previewScore = targetPos?.lines[0]?.score;
    if (previewScore) {
      return { score: previewScore, whiteWin: undefined };
    }
    const fallbackIndex = preview.line === "best" ? Math.max(0, shownIndex - 1) : shownIndex;
    return { score: undefined, whiteWin: whiteWin[fallbackIndex] };
  }

  const pos = positions[shownIndex];
  const score = pos?.lines[0]?.score;
  const fallbackWin = !pos?.lines.length ? whiteWin[shownIndex] : undefined;
  return { score, whiteWin: fallbackWin };
}
