// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen } from "@kingside/chess-core";
import type { Key } from "chessground/types";
import { Activity, Cpu, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { EvalBar } from "@/components/eval-bar";
import { Button } from "@/components/ui/button";
import { ENGINE_NAME } from "@/engine/stockfish-engine";
import { cn } from "@/lib/utils";
import { DEPTH_PRESETS, type PlayerInfo, useReview } from "./review-store";
import { runReview } from "./run-review";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** 400000 → "400k", 1500000 → "1.5M". */
export function formatNodes(n: number): string {
  return n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}k`;
}

function ScanningPlayerBar({ player, color }: { player: PlayerInfo; color: "white" | "black" }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-xs md:py-1.5 md:text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-3 shrink-0 rounded-full border border-border",
            color === "white" ? "bg-[var(--eval-white-bg)]" : "bg-[var(--eval-black-bg)]",
          )}
        />
        <span className="truncate font-medium">{player.name}</span>
        {player.rating && <span className="text-muted-foreground">({player.rating})</span>}
      </span>
    </div>
  );
}

export function ReviewProgress() {
  const t = useTranslations("review.progress");
  const { fens, moves, positions, progress, activeIndex, recheck, download, preset, meta, reset, fail } =
    useReview();
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
  const firstPct = total ? Math.min(80, Math.round((progress / total) * 80)) : 0;
  const secondPct =
    progress >= total && total && recheck.total ? Math.round((recheck.done / recheck.total) * 20) : 0;
  const pct = Math.min(100, firstPct + secondPct);
  const rechecking = recheck.total > 0 && progress >= total;
  const downloading = download !== null && download < 1;

  const orientation = meta?.me ?? "white";
  const topColor = orientation === "white" ? "black" : "white";
  const previewIndex =
    activeIndex !== null
      ? Math.max(0, Math.min(activeIndex, Math.max(0, fens.length - 1)))
      : Math.min(progress, Math.max(0, fens.length - 1));
  const previewFen = fens[previewIndex] ?? START_FEN;
  const previewScore =
    positions[previewIndex]?.lines[0]?.score ?? positions[Math.max(0, progress - 1)]?.lines[0]?.score;
  const lastUci = previewIndex > 0 ? moves[previewIndex - 1]?.uci : undefined;
  const lastMove: [Key, Key] | undefined = lastUci
    ? [lastUci.slice(0, 2) as Key, lastUci.slice(2, 4) as Key]
    : undefined;

  let previewTurn: "white" | "black" = "white";
  let previewCheck = false;
  let previewWhiteWin: number | undefined;
  try {
    const pos = positionFromFen(previewFen);
    previewTurn = pos.turn;
    previewCheck = pos.isCheck();
    if (!previewScore) {
      if (pos.isCheckmate()) previewWhiteWin = pos.turn === "white" ? 0 : 100;
      else if (pos.isStalemate() || pos.isInsufficientMaterial()) previewWhiteWin = 50;
    }
  } catch {
    // Fallback to defaults for malformed test FENs
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-2 overflow-hidden md:grid md:flex-initial md:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] md:items-center md:gap-6 md:overflow-visible md:py-4">
      <div className="min-w-0 shrink-0">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-22rem))] md:max-w-[min(100%,calc(100dvh-9.5rem),38rem)]">
          {meta && <ScanningPlayerBar player={meta[topColor]} color={topColor} />}
          <div className="flex gap-1.5 md:gap-2">
            <EvalBar
              score={previewScore}
              whiteWin={previewWhiteWin}
              orientation={orientation}
              className="w-6 shrink-0 sm:w-7"
            />
            <div className="min-w-0 flex-1">
              <ChessBoard
                fen={previewFen}
                orientation={orientation}
                turnColor={previewTurn}
                lastMove={lastMove}
                check={previewCheck}
              />
            </div>
          </div>
          {meta && <ScanningPlayerBar player={meta[orientation]} color={orientation} />}
        </div>
      </div>

      <section
        aria-label={t("progress")}
        className="glass flex min-h-0 flex-1 flex-col justify-between gap-3 overflow-y-auto rounded-2xl p-4 sm:p-6 md:flex-initial"
      >
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wider text-primary uppercase">{t("heading")}</p>
              <h1 className="font-display text-2xl tracking-tight sm:text-3xl">{t("title")}</h1>
              {meta && (
                <p className="mt-1 truncate text-xs text-muted-foreground sm:text-sm">
                  {t("players", { white: meta.white.name, black: meta.black.name })}
                </p>
              )}
            </div>
            <Loader2 className="mt-1 size-5 shrink-0 animate-spin text-primary" aria-hidden />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-muted-foreground">
                {downloading ? t("stageDownloading") : rechecking ? t("pass2") : t("pass1")}
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {downloading ? `${Math.round(download * 100)}%` : `${pct}%`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={downloading ? Math.round(download * 100) : pct}
              aria-label={t("progress")}
              className="flex h-3 overflow-hidden rounded-full bg-secondary"
            >
              {downloading ? (
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.round(download * 100)}%` }}
                />
              ) : (
                <>
                  <div
                    className="h-full bg-primary transition-[width] duration-300"
                    style={{ width: `${firstPct}%` }}
                  />
                  {secondPct > 0 && (
                    <div
                      className="h-full bg-[var(--eval-tb-bg)] transition-[width] duration-300"
                      style={{ width: `${secondPct}%` }}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border bg-surface-well/60 px-3 py-2">
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="size-3.5 text-primary" aria-hidden />
                <span>{rechecking ? t("pass2") : t("pass1")}</span>
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {rechecking
                  ? t("recheckCounter", { done: recheck.done, total: recheck.total })
                  : t("plyCounter", { done: progress, total })}
              </p>
            </div>
            <div className="rounded-xl border bg-surface-well/60 px-3 py-2">
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Cpu className="size-3.5 text-primary" aria-hidden />
                <span className="truncate">{ENGINE_NAME}</span>
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {t("throughput", { nodes: formatNodes(rechecking ? recheckNodes : nodes) })}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {downloading
              ? t("downloading", { pct: Math.round(download * 100) })
              : rechecking
                ? t("recheck", { done: recheck.done, total: recheck.total })
                : t("status", { done: progress, total, engine: ENGINE_NAME, nodes: formatNodes(nodes) })}
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="outline" size="sm" className="min-h-10" onClick={reset}>
            <X /> {t("cancel")}
          </Button>
        </div>
      </section>
    </div>
  );
}
