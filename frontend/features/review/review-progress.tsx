// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ENGINE_NAME } from "@/engine/stockfish-engine";
import { DEPTH_PRESETS, useReview } from "./review-store";
import { runReview } from "./run-review";

/** 400000 → "400k", 1500000 → "1.5M". */
export function formatNodes(n: number): string {
  return n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}k`;
}

export function ReviewProgress() {
  const t = useTranslations("review.progress");
  const { fens, progress, recheck, download, preset, meta, reset, fail } = useReview();
  const settings = DEPTH_PRESETS.find((p) => p.id === preset) ?? DEPTH_PRESETS[1];
  const { nodes, recheckNodes } = settings;

  useEffect(() => {
    const controller = new AbortController();
    runReview({ nodes, recheckNodes }, controller.signal).catch((e: unknown) => {
      if (controller.signal.aborted) return;
      console.error(e);
      fail("analysisStopped");
    });
    return () => controller.abort();
  }, [nodes, recheckNodes, fail]);

  const total = fens.length;
  // First pass = 80 % of the bar, the deeper second look = the rest.
  const first = total ? progress / total : 0;
  const second = recheck.total ? recheck.done / recheck.total : 0;
  const pct = Math.round(first * 80 + (progress >= total && total ? second * 20 : 0));
  const rechecking = recheck.total > 0 && progress >= total;
  const downloading = download !== null && download < 1;

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <Loader2 className="mx-auto mb-6 size-10 animate-spin text-primary" aria-hidden />
      <h1 className="font-display text-4xl tracking-tight">{t("title")}</h1>
      {meta && (
        <p className="mt-2 text-muted-foreground">
          {t("players", { white: meta.white.name, black: meta.black.name })}
        </p>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t("progress")}
        className="mt-8 h-3 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-gold transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {downloading
          ? t("downloading", { pct: Math.round(download * 100) })
          : rechecking
            ? t("recheck", { done: recheck.done, total: recheck.total })
            : t("status", { done: progress, total, engine: ENGINE_NAME, nodes: formatNodes(nodes) })}
      </p>
      <Button variant="ghost" className="mt-6" onClick={reset}>
        <X /> {t("cancel")}
      </Button>
    </div>
  );
}
