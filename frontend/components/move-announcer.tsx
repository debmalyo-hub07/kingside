// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { type SpeechWords, speakMove } from "@/lib/speak-move";

/** Screen-reader live region announcing the shown move (WCAG 4.1.3 status messages). */
export function MoveAnnouncer({
  san,
  ply,
  extra,
}: {
  san: string | undefined;
  ply: number;
  extra?: string | null;
}) {
  const t = useTranslations("speech");
  const words = useMemo<SpeechWords>(
    () => ({
      pieces: { K: t("pieces.K"), Q: t("pieces.Q"), R: t("pieces.R"), B: t("pieces.B"), N: t("pieces.N") },
      promoted: { Q: t("promoted.Q"), R: t("promoted.R"), B: t("promoted.B"), N: t("promoted.N") },
      pawn: t("pawn"),
      filePawn: (file) => t("filePawn", { file }),
      takes: (square) => t("takes", { square }),
      to: (square) => t("to", { square }),
      promotesTo: (piece) => t("promotesTo", { piece }),
      castleKingside: t("castleKingside"),
      castleQueenside: t("castleQueenside"),
      check: t("check"),
      checkmate: t("checkmate"),
      move: (n, white, text) => t(white ? "moveWhite" : "moveBlack", { n, text }),
    }),
    [t],
  );
  const text = san ? `${speakMove(san, ply, words)}${extra ? `. ${extra}` : ""}` : (extra ?? "");
  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </p>
  );
}
