// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ReviewImport } from "./review-import";
import { ReviewProgress } from "./review-progress";
import { ReviewReport } from "./review-report";
import { useReview } from "./review-store";

export function ReviewView() {
  const stage = useReview((s) => s.stage);
  if (stage === "analyzing") return <ReviewProgress />;
  if (stage === "report") return <ReviewReport />;
  return <ReviewImport />;
}
