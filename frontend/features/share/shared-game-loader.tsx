// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";
import { GameViewer, type SharedGame } from "./game-viewer";

/** Loads /api/share/:id and shows the game (full page or embed). */
export function SharedGameLoader({ id, embed = false }: { id: string; embed?: boolean }) {
  const t = useTranslations("viewer");
  const [state, setState] = useState<
    { status: "loading" } | { status: "ok"; game: SharedGame } | { status: "error"; code: string }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    apiGet<SharedGame>(`/api/share/${encodeURIComponent(id)}`, controller.signal).then(
      (game) => setState({ status: "ok", game }),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ status: "error", code: e instanceof ApiError ? e.code : "request_failed" });
      },
    );
    return () => controller.abort();
  }, [id]);

  if (state.status === "ok") return <GameViewer game={state.game} embed={embed} />;
  return (
    <div
      className={embed ? "grid h-dvh place-items-center p-4 text-sm" : "grid min-h-[50vh] place-items-center"}
    >
      {state.status === "loading" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t("loading")}
        </p>
      ) : (
        <div className="space-y-3 text-center">
          <p role="alert">
            {state.code === "not_found" || state.code === "invalid_request"
              ? t("notFound")
              : state.code === "backend_unreachable"
                ? t("offline")
                : t("error")}
          </p>
          {!embed && (
            <Link href="/analysis" className="text-sm text-primary hover:underline">
              {t("goAnalysis")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
