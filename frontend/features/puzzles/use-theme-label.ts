// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { prettyTheme } from "./puzzle-data";

/** Translated puzzle theme name, with a readable fallback for tags not in the catalog. */
export function useThemeLabel(): (id: string) => string {
  const t = useTranslations("puzzles.themes");
  return useCallback((id: string) => (t.has(id as never) ? t(id as never) : prettyTheme(id)), [t]);
}
