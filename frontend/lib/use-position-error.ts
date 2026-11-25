// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { InvalidPositionError } from "@kingside/chess-core";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

/** Turns an error from loading a FEN/PGN into a translated, readable message. */
export function usePositionErrorText(): (error: unknown) => string {
  const t = useTranslations("errors.position");
  return useCallback(
    (error: unknown) => (error instanceof InvalidPositionError ? t(error.code) : t("unknown")),
    [t],
  );
}
