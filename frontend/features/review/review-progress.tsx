// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen, winPercentFromScore } from "@kingside/chess-core";
import type { Key } from "chessground/types";
import {
  Activity,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FlipVertical2,
  Loader2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { EvalBar, formatScore } from "@/components/eval-bar";
import { EvalGraph, type GraphPointMeta } from "@/components/eval-graph";
import { Button } from "@/components/ui/button";
import { ENGINE_NAME } from "@/engine/stockfish-engine";
import { colorOfPly, formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { DEPTH_PRESETS, type PlayerInfo, useReview } from "./review-store";
import { runReview } from "./run-review";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null)
  );
}

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
  const tr = useTranslations("review.report");
  const notation = useSettings((s) => s.notation);
  const {
    fens,
    moves,
    positions,
    progress,
    ply,
    orientation: storeOrientation,
    goTo,
    setOrientation,
    recheck,
    download,
    preset,
    meta,
    reset,
    fail,
  } = useReview();
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
  const maxPly = Math.max(0, total - 1);
  // First pass = 80 % of the bar, the deeper second look = the rest.
  const firstPct = total ? Math.min(80, Math.round((progress / total) * 80)) : 0;
  const secondPct =
    progress >= total && total && recheck.total ? Math.round((recheck.done / recheck.total) * 20) : 0;
  const pct = Math.min(100, firstPct + secondPct);
  const rechecking = recheck.total > 0 && progress >= total;
  const downloading = download !== null && download < 1;

  // Board & EvalBar stay steady on the user-selected ply, decoupled from background Pass 1/Pass 2 scan order.
  const orientation = storeOrientation ?? meta?.me ?? "white";
  const topColor = orientation === "white" ? "black" : "white";
  const previewIndex = Math.max(0, Math.min(ply, maxPly));
  const prevPreviewIndexRef = useRef(previewIndex);
  const isNonAdjacentJump = Math.abs(previewIndex - prevPreviewIndexRef.current) > 1;
  useEffect(() => {
    prevPreviewIndexRef.current = previewIndex;
  }, [previewIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useReview.getState();
      const max = Math.max(0, s.fens.length - 1);
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        s.goTo(s.ply - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        s.goTo(s.ply + 1);
      } else if (e.key === "ArrowUp" || e.key === "Home") {
        e.preventDefault();
        s.goTo(0);
      } else if (e.key === "ArrowDown" || e.key === "End") {
        e.preventDefault();
        s.goTo(max);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        s.setOrientation(s.orientation === "white" ? "black" : "white");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const previewFen = fens[previewIndex] ?? START_FEN;
  const previewScore = positions[previewIndex]?.lines[0]?.score;
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

  const liveGraph = useMemo(() => {
    if (fens.length < 2) return null;
    const whiteWin: number[] = [];
    const evaluated: boolean[] = [];
    const graphMeta: (GraphPointMeta | undefined)[] = [];
    for (let i = 0; i < fens.length; i++) {
      const score = positions[i]?.lines[0]?.score;
      let terminalWin: number | undefined;
      if (!score) {
        try {
          const p = positionFromFen(fens[i] as string);
          if (p.isCheckmate()) terminalWin = p.turn === "white" ? 0 : 100;
          else if (p.isStalemate() || p.isInsufficientMaterial()) terminalWin = 50;
        } catch {
          // ignore malformed FENs
        }
      }
      const hasEval = Boolean(score) || terminalWin !== undefined;
      evaluated.push(hasEval);
      whiteWin.push(score ? winPercentFromScore(score) : (terminalWin ?? 50));
      const move = i > 0 ? moves[i - 1] : undefined;
      if (!move?.san) {
        graphMeta.push(undefined);
      } else {
        const col = colorOfPly(i);
        const sanText = `${Math.ceil(i / 2)}${col === "white" ? "." : "…"} ${formatSan(move.san, notation, col)}`;
        const scoreLabel = score ? formatScore(score) : undefined;
        graphMeta.push({
          san: sanText,
          ...(scoreLabel ? { scoreLabel } : {}),
        });
      }
    }
    return { whiteWin, evaluated, meta: graphMeta };
  }, [fens, positions, moves, notation]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-2 overflow-hidden md:grid md:flex-initial md:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] md:items-center md:gap-6 md:overflow-visible md:py-4">
      <div className="min-w-0 shrink-0 space-y-1.5">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-25rem))] md:max-w-[min(100%,calc(100dvh-11rem),38rem)]">
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
                animationMs={isNonAdjacentJump ? 0 : undefined}
              />
            </div>
          </div>
          {meta && <ScanningPlayerBar player={meta[orientation]} color={orientation} />}
        </div>

        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-25rem))] space-y-1.5 md:max-w-[min(100%,calc(100dvh-11rem),38rem)]">
          <nav
            aria-label={tr("mobileControls")}
            className="flex flex-nowrap items-center justify-center gap-0.5 rounded-xl border bg-card/90 p-0.5 shadow-xs"
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-9 min-w-0 flex-1 px-0 md:flex-initial md:px-2.5"
              aria-label={tr("start")}
              disabled={previewIndex <= 0}
              onClick={() => goTo(0)}
            >
              <ChevronFirst />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 min-w-0 flex-1 px-0 md:flex-initial md:px-2.5"
              aria-label={tr("previous")}
              disabled={previewIndex <= 0}
              onClick={() => goTo(previewIndex - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 min-w-0 flex-1 px-0 md:flex-initial md:px-2.5"
              aria-label={tr("next")}
              disabled={previewIndex >= maxPly}
              onClick={() => goTo(previewIndex + 1)}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 min-w-0 flex-1 px-0 md:flex-initial md:px-2.5"
              aria-label={tr("end")}
              disabled={previewIndex >= maxPly}
              onClick={() => goTo(maxPly)}
            >
              <ChevronLast />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 min-w-0 flex-1 px-0 md:flex-initial md:px-2.5"
              aria-label={tr("flip")}
              onClick={() => setOrientation(orientation === "white" ? "black" : "white")}
            >
              <FlipVertical2 />
            </Button>
          </nav>

          {liveGraph && (
            <EvalGraph
              whiteWin={liveGraph.whiteWin}
              evaluated={liveGraph.evaluated}
              index={previewIndex}
              onSeek={goTo}
              meta={liveGraph.meta}
              compact
            />
          )}
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
