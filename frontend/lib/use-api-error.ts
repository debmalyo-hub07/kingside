// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { ApiError } from "./api";

/** Translated text for a backend error (`{ error: "<code>" }`), or a generic fallback. */
export function useApiErrorText(): (error: unknown) => string {
  const t = useTranslations("apiErrors");
  return useCallback(
    (error: unknown) => {
      const code = error instanceof ApiError ? error.code : "generic";
      return t.has(code as never) ? t(code as never) : t("generic");
    },
    [t],
  );
}
