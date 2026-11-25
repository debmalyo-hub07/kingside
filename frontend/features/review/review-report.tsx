// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  addMove,
  createTree,
  type MoveClass,
  type MoveReview,
  nodeAtPath,
  nodesAlongPath,
  positionFromFen,
} from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ExternalLink,
  FlipVertical2,
  LineChart,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { EvalBar } from "@/components/eval-bar";
import { EvalGraph, type GraphMarker } from "@/components/eval-graph";
import { Button } from "@/components/ui/button";
import {
  clampEngineHash,
  clampEngineThreads,
  engineThreadsAvailable,
  prefetchEngine,
  StockfishEngine,
} from "@/engine/stockfish-engine";
import { ShareDialog } from "@/features/share/share-dialog";
import { formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { CoachCard, formatSeconds, type Preview, RETRYABLE, type RetryState } from "./coach-card";
import { Captured } from "./material";
import { badgeSquare, CLASS_META, MoveClassBadge, SquareBadge, useClassLabel } from "./move-classes";
import { judgeAlternativeMove, RETRY_TOLERANCE } from "./retry-judge";
import { ReviewOptions } from "./review-options";
import { type PlayerInfo, useReview } from "./review-store";
import { accuracyTone, ReviewSummary } from "./review-summary";

const MARKED = new Set<MoveClass>(["brilliant", "great", "mistake", "miss", "blunder"]);
const LOUD = new Set<MoveClass>(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"]);
const RETRY_NODES = 300_000;
const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;

function PlayerBar({
  player,
  color,
  accuracy,
  fen,
}: {
  player: PlayerInfo;
  color: "white" | "black";
  accuracy: number | null;
  fen: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-1.5 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "size-3 shrink-0 rounded-full border",
            color === "white" ? "border-neutral-400 bg-white" : "border-neutral-500 bg-neutral-900",
          )}
        />
        <span className="truncate font-medium">{player.name}</span>
        {player.rating && <span className="text-muted-foreground">({player.rating})</span>}
        <Captured fen={fen} color={color} />
      </span>
      <span className={cn("font-mono font-semibold", accuracyTone(accuracy))}>
        {accuracy === null ? "—" : `${accuracy.toFixed(1)}%`}
      </span>
    </div>
  );
}

/** Always-visible move table: label badge per move, current move highlighted and kept in view. */
function MoveTable({ onSeek }: { onSeek: (ply: number) => void }) {
  const { review, ply, moveTimes } = useReview();
  const notation = useSettings((s) => s.notation);
  const showTimes = useSettings((s) => s.reviewMoveTimes) && moveTimes.some((x) => x !== null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-ply="${ply}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ply]);
  if (!review) return null;
  const rows: [MoveReview | undefined, MoveReview | undefined][] = [];
  const first = review.moves[0];
  let i = 0;
  if (first?.color === "black") {
    rows.push([undefined, first]);
    i = 1;
  }
  for (; i < review.moves.length; i += 2) rows.push([review.moves[i], review.moves[i + 1]]);

  const cell = (m: MoveReview | undefined) =>
    m ? (
      <button
        type="button"
        data-ply={m.ply}
        onClick={() => onSeek(m.ply)}
        aria-current={ply === m.ply ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-sm transition hover:bg-accent",
          ply === m.ply && "bg-primary text-primary-foreground shadow-sm hover:bg-primary",
          LOUD.has(m.classification) && "font-semibold",
        )}
      >
        <MoveClassBadge cls={m.classification} className="size-4 text-[8px]" />
        <span className="truncate">{formatSan(m.san, notation, m.color)}</span>
        {showTimes && moveTimes[m.ply - 1] !== null && moveTimes[m.ply - 1] !== undefined && (
          <span className={cn("ml-auto text-[10px] opacity-60", ply === m.ply && "opacity-80")}>
            {formatSeconds(moveTimes[m.ply - 1] as number)}
          </span>
        )}
      </button>
    ) : (
      <span />
    );

  return (
    <div ref={scroller} className="max-h-64 overflow-y-auto border-b p-2 lg:max-h-80">
      <table className="w-full">
        <tbody>
          {rows.map(([w, b], r) => (
            <tr key={w?.ply ?? b?.ply ?? r}>
              <td className="w-9 pr-1 text-right font-mono text-xs text-muted-foreground">
                {`${Math.ceil(((w ?? b)?.ply ?? 1) / 2)}.`}
              </td>
              <td className="w-1/2">{cell(w)}</td>
              <td className="w-1/2">{cell(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Position and last move after playing `plies` moves of a UCI line from `fen`. */
function playLine(fen: string, ucis: readonly string[], plies: number): { fen: string; last?: string } {
  const tree = createTree(fen);
  let path: string[] = [];
  let last: string | undefined;
  for (const uci of ucis.slice(0, plies)) {
    const next = addMove(tree, path, uci);
    if (!next) break;
    path = next;
    last = uci;
  }
  return { fen: nodesAlongPath(tree, path).at(-1)?.fen ?? fen, ...(last ? { last } : {}) };
}

function toKeys(uci: string | undefined): [Key, Key] | undefined {
  return uci ? [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] : undefined;
}

export function ReviewReport() {
  const t = useTranslations("review.report");
  const tImport = useTranslations("review.import");
  const classLabel = useClassLabel();
  const settings = useSettings();
  const { review, meta, fens, moves, positions, ply, goTo, reset, pgn } = useReview();
  const [orientation, setOrientation] = useState<"white" | "black">(() => meta?.me ?? "white");
  const [retry, setRetry] = useState<RetryState | null>(null);
  const [retryPromotion, setRetryPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const boardApi = useRef<Api | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const engine = useRef<StockfishEngine | null>(null);
  const retryAbort = useRef<AbortController | null>(null);
  const retrySeq = useRef(0);

  const cancelRetryCheck = useCallback(() => {
    retryAbort.current?.abort();
    retryAbort.current = null;
    retrySeq.current++;
    engine.current?.stop();
    setRetryPromotion(null);
  }, []);

  useEffect(() => {
    setOrientation(meta?.me ?? "white");
  }, [meta?.me]);

  useEffect(() => {
    if (!retry) cancelRetryCheck();
  }, [retry, cancelRetryCheck]);

  useEffect(
    () => () => {
      retryAbort.current?.abort();
      engine.current?.destroy();
    },
    [],
  );

  const move = ply > 0 ? review?.moves[ply - 1] : undefined;

  const keyPlies = useMemo(
    () =>
      (review?.keyMoments ?? []).filter((p) => {
        const m = review?.moves[p - 1];
        return m && (settings.reviewKeyFor === "both" || m.color === settings.reviewKeyFor);
      }),
    [review, settings.reviewKeyFor],
  );
  const nextKey = keyPlies.find((p) => p > ply);

  const seek = useCallback(
    (p: number) => {
      cancelRetryCheck();
      setRetry(null);
      setPreview(null);
      goTo(p);
    },
    [goTo, cancelRetryCheck],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) ||
          e.target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null)
      ) {
        return;
      }
      const s = useReview.getState();
      const map: Record<string, () => void> = {
        ArrowLeft: () => seek(s.ply - 1),
        ArrowRight: () => seek(s.ply + 1),
        ArrowUp: () => seek(0),
        Home: () => seek(0),
        ArrowDown: () => seek(s.moves.length),
        End: () => seek(s.moves.length),
        Escape: () => {
          setPreview(null);
          setRetry(null);
        },
        f: () => setOrientation((o) => (o === "white" ? "black" : "white")),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seek]);

  const markers = useMemo<GraphMarker[]>(
    () =>
      (review?.moves ?? [])
        .filter((m) => MARKED.has(m.classification))
        .map((m) => ({
          index: m.ply,
          color: CLASS_META[m.classification].color,
          label: classLabel(m.classification),
        })),
    [review, classLabel],
  );

  if (!review || !meta) return null;

  const retrying = retry !== null;
  const before = move ? positions[move.ply - 1] : undefined;
  const after = move ? positions[move.ply] : undefined;

  // What the board shows: the game, a retry position, or a preview of an engine line.
  let boardFen = fens[ply] ?? "";
  let lastUci: string | undefined = ply > 0 ? moves[ply - 1]?.uci : undefined;
  let shownIndex = ply;
  if (retrying) {
    boardFen = fens[retry.ply - 1] ?? "";
    lastUci = retry.ply > 1 ? moves[retry.ply - 2]?.uci : undefined;
    shownIndex = retry.ply - 1;
  } else if (preview && move) {
    const from = preview.line === "best" ? move.ply - 1 : move.ply;
    const line = (preview.line === "best" ? before : after)?.lines[0]?.pv ?? [];
    const p = playLine(fens[from] ?? "", line, preview.plies);
    boardFen = p.fen;
    lastUci = p.last;
  }
  const boardPos = positionFromFen(boardFen);

  const shapes: DrawShape[] = [];
  if (retrying && move?.bestUci) {
    if (retry.hint >= 1) shapes.push({ orig: move.bestUci.slice(0, 2) as Key, brush: "yellow" });
    if (retry.hint >= 2)
      shapes.push({
        orig: move.bestUci.slice(0, 2) as Key,
        dest: move.bestUci.slice(2, 4) as Key,
        brush: "green",
      });
  } else if (!preview && move) {
    const notBest = !["best", "book", "forced", "brilliant", "great"].includes(move.classification);
    if (settings.reviewBestArrow && notBest && move.bestUci)
      shapes.push({
        orig: move.bestUci.slice(0, 2) as Key,
        dest: move.bestUci.slice(2, 4) as Key,
        brush: "green",
      });
    const reply = after?.lines[0]?.pv[0];
    if (settings.reviewThreatArrow && RETRYABLE.has(move.classification) && reply)
      shapes.push({ orig: reply.slice(0, 2) as Key, dest: reply.slice(2, 4) as Key, brush: "red" });
  }

  const startRetry = () => {
    if (!move) return;
    cancelRetryCheck();
    setPreview(null);
    setOrientation(move.color);
    setRetry({ ply: move.ply, result: "pending", hint: 0 });
  };

  const submitRetryMove = async (orig: Key, dest: Key, promo = "") => {
    if (!retry || !move) return;
    const uci = orig + dest + promo;
    const tree = createTree(boardFen);
    const path = addMove(tree, [], uci);
    const node = path ? nodeAtPath(tree, path) : undefined;
    const san = node?.san;
    if (!san || !node || !before) {
      boardApi.current?.set({ fen: boardFen });
      setRetry({ ...retry });
      return;
    }
    const tried = formatSan(san, settings.notation, move.color);
    if (san === move.bestSan || (move.bestUci && (node.uci ?? uci) === move.bestUci)) {
      setRetry({ ...retry, result: "correct", tried });
      return;
    }
    if ((node.uci ?? uci) === moves[retry.ply - 1]?.uci) {
      setRetry({ ...retry, result: "wrong", tried });
      return;
    }

    retryAbort.current?.abort();
    const controller = new AbortController();
    retryAbort.current = controller;
    const seq = ++retrySeq.current;
    const targetPly = retry.ply;

    // Any other move: resolve checkmate/draws cleanly, else check with Stockfish.
    setRetry({ ...retry, result: "checking", tried });
    try {
      const verdict = await judgeAlternativeMove({
        afterFen: node.fen,
        uci: node.uci ?? uci,
        san,
        color: move.color,
        lines: before.lines,
        bestSan: move.bestSan,
        bestUci: move.bestUci,
        playedUci: moves[retry.ply - 1]?.uci,
        tolerance: RETRY_TOLERANCE,
        evaluateScore: async () => {
          if (!engine.current) {
            await prefetchEngine("full");
            if (controller.signal.aborted || seq !== retrySeq.current) return undefined;
            const { engineThreads, engineHashMb } = useSettings.getState();
            const available = engineThreadsAvailable();
            const threads = clampEngineThreads(
              engineThreads > 0 ? Math.min(engineThreads, available) : available,
            );
            const hashMb = clampEngineHash(engineHashMb);
            engine.current = new StockfishEngine({ threads, hashMb, net: "full" });
          }
          const snap = await engine.current.evaluate(
            node.fen,
            { depth: null, nodes: RETRY_NODES, multiPv: 1 },
            controller.signal,
          );
          return snap.lines[0]?.score;
        },
      });
      if (controller.signal.aborted || seq !== retrySeq.current) return;
      setRetry((r) => (r && r.ply === targetPly ? { ...r, result: verdict, tried } : r));
    } catch {
      engine.current?.destroy();
      engine.current = null;
      if (controller.signal.aborted || seq !== retrySeq.current) return;
      boardApi.current?.set({ fen: fens[targetPly - 1] ?? boardFen });
      setRetry((r) => (r && r.ply === targetPly ? { ...r, result: "pending", hint: r.hint } : r));
    }
  };

  const onRetryMove = async (orig: Key, dest: Key) => {
    if (!retry || !move) return;
    const sq = parseSquare(orig);
    const moving = sq !== undefined ? boardPos.board.get(sq) : undefined;
    if (moving?.role === "pawn" && (dest[1] === "8" || dest[1] === "1")) {
      setRetryPromotion({ orig, dest });
      return;
    }
    await submitRetryMove(orig, dest);
  };

  const metric = settings.reviewMetric;
  const sideScore = (c: "white" | "black") =>
    metric === "precision" ? review[c].precision : review[c].accuracy;

  const summaryBlock = <ReviewSummary onSeek={seek} />;

  return (
    <>
      <h1 className="sr-only">{tImport("title")}</h1>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,23.5rem)] lg:grid-rows-[auto_1fr] lg:gap-x-4 lg:gap-y-2 xl:grid-cols-[minmax(15.5rem,17.5rem)_minmax(0,1fr)_minmax(300px,21rem)]">
        <section
          aria-label={t("tabs.summary")}
          className="glass hidden max-h-[calc(100dvh-7rem)] self-start overflow-y-auto rounded-2xl xl:sticky xl:top-20 xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:block"
        >
          <h2 className="px-4 pt-4 text-sm font-semibold">{t("tabs.summary")}</h2>
          {summaryBlock}
        </section>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1 xl:col-start-2">
          <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-7.75rem),42.75rem)]">
            <PlayerBar
              player={orientation === "white" ? meta.black : meta.white}
              color={orientation === "white" ? "black" : "white"}
              accuracy={sideScore(orientation === "white" ? "black" : "white")}
              fen={boardFen}
            />
            <div className="flex gap-2">
              <EvalBar
                score={preview ? undefined : positions[shownIndex]?.lines[0]?.score}
                whiteWin={
                  preview || !positions[shownIndex]?.lines.length ? review.whiteWin[shownIndex] : undefined
                }
                orientation={orientation}
                className="w-6 shrink-0 sm:w-7"
              />
              <div className="relative min-w-0 flex-1">
                <ChessBoard
                  sound
                  fen={boardFen}
                  orientation={orientation}
                  turnColor={boardPos.turn}
                  lastMove={toKeys(lastUci)}
                  check={boardPos.isCheck()}
                  autoShapes={shapes}
                  onReady={(a) => {
                    boardApi.current = a;
                  }}
                  {...(retrying && retry.result === "pending" && !retryPromotion
                    ? { dests: chessgroundDests(boardPos) as Map<Key, Key[]>, onMove: onRetryMove }
                    : {})}
                >
                  {retryPromotion && (
                    <PromotionPicker
                      color={boardPos.turn}
                      onPick={(role) => {
                        const { orig, dest } = retryPromotion;
                        setRetryPromotion(null);
                        void submitRetryMove(orig, dest, ROLE_CHAR[role]);
                      }}
                      onCancel={() => {
                        setRetryPromotion(null);
                        boardApi.current?.set({ fen: boardFen });
                      }}
                    />
                  )}
                  {move && !retrying && !preview && settings.reviewBadges && lastUci && (
                    <SquareBadge
                      cls={move.classification}
                      square={badgeSquare(lastUci, move.san)}
                      orientation={orientation}
                    />
                  )}
                </ChessBoard>
                {preview && (
                  <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/85 px-2 py-0.5 text-xs font-medium shadow">
                    {t(preview.line === "best" ? "previewBest" : "previewReply")}
                  </span>
                )}
              </div>
            </div>
            <PlayerBar
              player={orientation === "white" ? meta.white : meta.black}
              color={orientation}
              accuracy={sideScore(orientation)}
              fen={boardFen}
            />
          </div>
        </div>

        <nav
          aria-label={t("mobileControls")}
          className="sticky top-[4.25rem] z-20 flex flex-wrap items-center justify-between gap-1 rounded-xl border bg-background/90 px-2 py-1.5 shadow-md backdrop-blur-xl lg:hidden"
        >
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={t("previous")}
              onClick={() => seek(ply - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={t("next")}
              onClick={() => seek(ply + 1)}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={t("nextKey")}
              title={t("nextKey")}
              disabled={nextKey === undefined}
              onClick={() => nextKey !== undefined && seek(nextKey)}
            >
              <ChevronsRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={t("flip")}
              onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
            >
              <FlipVertical2 />
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="min-h-10 px-2.5 text-xs"
            onClick={() => guideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {t("tacticalGuide")}
          </Button>
        </nav>

        <div className="min-w-0 space-y-2 self-start lg:col-start-1 lg:row-start-2 xl:col-start-2">
          <EvalGraph whiteWin={review.whiteWin} index={ply} onSeek={seek} markers={markers} />
          <div className="flex flex-wrap items-center justify-center gap-1">
            <Button variant="ghost" size="icon" aria-label={t("start")} onClick={() => seek(0)}>
              <ChevronFirst />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={t("previous")}
              onClick={() => seek(ply - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={t("next")}
              onClick={() => seek(ply + 1)}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("end")}
              onClick={() => seek(review.moves.length)}
            >
              <ChevronLast />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={t("nextKey")}
              title={t("nextKey")}
              disabled={nextKey === undefined}
              onClick={() => nextKey !== undefined && seek(nextKey)}
            >
              <ChevronsRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={t("flip")}
              onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
            >
              <FlipVertical2 />
            </Button>
            <ReviewOptions />
            <BoardSettings />
          </div>
        </div>

        <aside className="glass flex min-w-0 flex-col self-start overflow-hidden rounded-2xl lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-7rem)] xl:col-start-3">
          <div id="tactical-guide" ref={guideRef} className="scroll-mt-32 border-b">
            <CoachCard
              move={move}
              previous={move ? review.moves[move.ply - 2] : undefined}
              retry={retry}
              setRetry={setRetry}
              preview={preview}
              setPreview={setPreview}
              onRetryStart={startRetry}
              onNextKey={() => nextKey !== undefined && seek(nextKey)}
              hasNextKey={nextKey !== undefined}
            />
          </div>

          <MoveTable onSeek={seek} />
          <div className="min-h-0 flex-1 overflow-y-auto xl:hidden">
            <h2 className="px-4 pt-3 text-sm font-semibold">{t("tabs.summary")}</h2>
            {summaryBlock}
          </div>

          <div className="flex flex-wrap gap-2 border-t p-3">
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("newReview")}
            </Button>
            <ShareDialog
              target={{
                pgn,
                fens,
                moves: moves.map((m) => m.uci),
                ply,
                fen: fens[ply] ?? "",
                lastMove: ply > 0 ? moves[ply - 1]?.uci : undefined,
                orientation,
                analysis: {
                  whiteWin: review.whiteWin,
                  classes: review.moves.map((m) => m.classification),
                  accuracy: { white: review.white.accuracy, black: review.black.accuracy },
                },
                white: meta.white.name,
                black: meta.black.name,
                date: meta.date,
              }}
            />
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/analysis?fen=${encodeURIComponent(boardFen)}`}>
                <LineChart /> {t("analyzePosition")}
              </Link>
            </Button>
            {meta.url && (
              <Button variant="ghost" size="sm" asChild>
                <a href={meta.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> {t("original")}
                </a>
              </Button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
