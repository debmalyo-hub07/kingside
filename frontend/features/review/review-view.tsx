// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { pgnHash } from "@/lib/local-db";
import { ReviewImport } from "./review-import";
import { ReviewProgress } from "./review-progress";
import { ReviewReport } from "./review-report";
import { useReview } from "./review-store";

export function ReviewView({
  initialSite,
  initialUser,
  initialGame,
}: {
  initialSite?: string | undefined;
  initialUser?: string | undefined;
  initialGame?: string | undefined;
}) {
  const t = useTranslations("review");
  const stage = useReview((s) => s.stage);
  const pgn = useReview((s) => s.pgn);
  const ply = useReview((s) => s.ply);
  const hydrating = useReview((s) => s.hydrating);
  const handledQueryRef = useRef<string | null>(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    const trimmedUser = initialUser?.trim();
    if ((initialSite === "lichess" || initialSite === "chesscom") && trimmedUser) {
      const key = `${initialSite}\0${trimmedUser}`;
      if (handledQueryRef.current === key) return;
      handledQueryRef.current = key;
      bootedRef.current = true;
      useReview.getState().prepareImportLookup(initialSite, trimmedUser);
      return;
    }

    handledQueryRef.current = null;
    if (bootedRef.current) return;
    bootedRef.current = true;

    const rawHash = window.location.hash.slice(1);
    const hashPly = /^\d+$/.test(rawHash) ? Number.parseInt(rawHash, 10) : null;
    const cur = useReview.getState();

    if (initialGame) {
      if (cur.stage === "report" && cur.pgn && pgnHash(cur.pgn) === initialGame) {
        if (hashPly !== null && hashPly !== cur.ply) cur.goTo(hashPly);
      } else {
        void cur.restoreFromSessionOrDb(initialGame, hashPly);
      }
      return;
    }

    if (cur.stage === "select" && !cur.pgn) {
      void cur.restoreFromSessionOrDb(undefined, hashPly);
    }
  }, [initialSite, initialUser, initialGame]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cur = useReview.getState();
    // Skip URL sync if useEffect above just mutated Zustand synchronously (stale render closure) or a lookup is queued.
    if (
      cur.stage !== stage ||
      cur.pgn !== pgn ||
      cur.ply !== ply ||
      cur.hydrating !== hydrating ||
      cur.pendingLookup !== null
    ) {
      return;
    }
    if ((stage === "report" || stage === "analyzing") && pgn) {
      const target =
        stage === "report"
          ? `/review?game=${encodeURIComponent(pgnHash(pgn))}#${ply}`
          : `/review?game=${encodeURIComponent(pgnHash(pgn))}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current !== target) {
        try {
          window.history.replaceState(null, "", target);
        } catch {
          // ignore
        }
      }
    } else if (stage === "select" && !hydrating && window.location.search.includes("game=")) {
      try {
        window.history.replaceState(null, "", "/review");
      } catch {
        // ignore
      }
    }
  }, [stage, pgn, ply, hydrating]);

  if (hydrating) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin text-primary" aria-hidden />
        <span>{t("restoring")}</span>
      </div>
    );
  }
  if (stage === "analyzing") return <ReviewProgress />;
  if (stage === "report") return <ReviewReport />;
  return <ReviewImport />;
}
