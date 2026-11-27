// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  addMove,
  createTree,
  explainMove,
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
  Pause,
  Play,
} from "lucide-react";
import { m } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardModeToggles } from "@/components/board/board-mode-toggles";
import { type BoardInteractionMode, ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { EvalBar, formatScore } from "@/components/eval-bar";
import { EvalGraph, type GraphMarker, type GraphPointMeta } from "@/components/eval-graph";
import { Button } from "@/components/ui/button";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import {
  clampEngineHash,
  clampEngineThreads,
  engineThreadsAvailable,
  prefetchEngine,
  StockfishEngine,
} from "@/engine/stockfish-engine";
import { useAnalysis } from "@/features/analysis/analysis-store";
import { MiniBoard } from "@/features/library/mini-board";
import { ShareDialog } from "@/features/share/share-dialog";
import { formatSan } from "@/lib/notation";
import { scrollChildIntoContainer } from "@/lib/scroll-container";
import { useSettings } from "@/lib/settings-store";
import { playSound } from "@/lib/sounds";
import { usePrefersReducedMotion } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";
import { CoachCard, formatSeconds, type Preview, RETRYABLE, type RetryState } from "./coach-card";
import { Captured } from "./material";
import { motifShapesForReasons } from "./motif-shapes";
import { badgeSquare, CLASS_META, MoveClassBadge, SquareBadge, useClassLabel } from "./move-classes";
import { judgeAlternativeMove, RETRY_TOLERANCE } from "./retry-judge";
import { resolveReviewEvalBar } from "./review-eval";
import { ReviewOptions } from "./review-options";
import { ReviewShortcutsGuideDialog, ReviewShortcutsGuideTrigger } from "./review-shortcuts-guide";
import { type PlayerInfo, useReview } from "./review-store";
import { accuracyTone, ReviewSummary } from "./review-summary";

const MARKED = new Set<MoveClass>(["brilliant", "great", "mistake", "miss", "blunder"]);
const LOUD = new Set<MoveClass>(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"]);
const RETRY_NODES = 300_000;
const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null)
  );
}

function isInteractiveControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      'button, a[href], summary, [role="button"], [role="switch"], [role="tab"], [role="checkbox"], [role="radio"], [role="slider"]',
    ) !== null
  );
}

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
        <Captured fen={fen} color={color} />
      </span>
      <span className={cn("font-mono font-semibold", accuracyTone(accuracy))}>
        {accuracy === null ? "—" : `${accuracy.toFixed(1)}%`}
      </span>
    </div>
  );
}

/** Always-visible move table: label badge per move, current move highlighted and kept in view. */
function MoveTable({
  onSeek,
  scrollTrigger,
  className,
}: {
  onSeek: (ply: number) => void;
  scrollTrigger?: unknown;
  className?: string;
}) {
  const { review, ply, moveTimes } = useReview();
  const notation = useSettings((s) => s.notation);
  const showTimes = useSettings((s) => s.reviewMoveTimes) && moveTimes.some((x) => x !== null);
  const scroller = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-center active move when mobile drawer switches back to Moves.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-ply="${ply}"]`);
    scrollChildIntoContainer(scroller.current, el);
  }, [ply, scrollTrigger]);
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
        <MoveClassBadge cls={m.classification} className="size-4" />
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
    <div
      ref={scroller}
      className={cn("min-h-0 overflow-y-auto border-b p-2 max-md:flex-1 md:max-h-64 lg:max-h-80", className)}
    >
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
  const {
    review,
    meta,
    fens,
    moves,
    positions,
    ply,
    goTo,
    reset,
    pgn,
    reportStage,
    setReportStage,
    orientation,
    setOrientation,
    mobileTab,
    setMobileTab,
    showMotifs,
    setShowMotifs,
  } = useReview();
  const [retry, setRetry] = useState<RetryState | null>(null);
  const [retryPromotion, setRetryPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [boardMode, setBoardMode] = useState<BoardInteractionMode>("play");
  const reduceMotion = usePrefersReducedMotion();
  const boardApi = useRef<Api | null>(null);
  const engine = useRef<StockfishEngine | null>(null);
  const retryAbort = useRef<AbortController | null>(null);
  const retrySeq = useRef(0);
  const autoSteppingRef = useRef(false);

  const cancelRetryCheck = useCallback(() => {
    retryAbort.current?.abort();
    retryAbort.current = null;
    retrySeq.current++;
    engine.current?.stop();
    setRetryPromotion(null);
  }, []);

  const stopAutoPlay = useCallback(() => setAutoPlay(false), []);

  // Clear transient preview/retry/autoPlay whenever a different review loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset transient view state when a new review arrives.
  useEffect(() => {
    setAutoPlay(false);
    setPreview(null);
    setRetry(null);
  }, [review]);

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
  const previousMove = move ? review?.moves[move.ply - 2] : undefined;

  const keyPlies = useMemo(
    () =>
      (review?.keyMoments ?? []).filter((p) => {
        const m = review?.moves[p - 1];
        return m && (settings.reviewKeyFor === "both" || m.color === settings.reviewKeyFor);
      }),
    [review, settings.reviewKeyFor],
  );
  const nextKey = keyPlies.find((p) => p > ply);

  const goOverview = useCallback(() => {
    stopAutoPlay();
    cancelRetryCheck();
    setRetry(null);
    setPreview(null);
    setReportStage("overview");
  }, [stopAutoPlay, cancelRetryCheck, setReportStage]);

  const toggleAutoPlay = useCallback(() => {
    if (!autoPlay) setPreview(null);
    setAutoPlay((v) => !v);
  }, [autoPlay]);

  const seek = useCallback(
    (p: number) => {
      stopAutoPlay();
      cancelRetryCheck();
      setRetry(null);
      setPreview(null);
      goTo(p);
    },
    [goTo, cancelRetryCheck, stopAutoPlay],
  );

  const enterGuided = useCallback(
    (targetPly?: number) => {
      stopAutoPlay();
      setReportStage("guided");
      if (targetPly !== undefined) {
        cancelRetryCheck();
        setRetry(null);
        setPreview(null);
        setMobileTab("guide");
        goTo(targetPly);
      }
    },
    [stopAutoPlay, cancelRetryCheck, goTo, setReportStage, setMobileTab],
  );

  const startRetry = useCallback(() => {
    if (!move) return;
    stopAutoPlay();
    cancelRetryCheck();
    setPreview(null);
    setOrientation(move.color);
    setRetry({ ply: move.ply, result: "pending", hint: 0 });
  }, [move, stopAutoPlay, cancelRetryCheck, setOrientation]);

  // Auto-Play stepping in Stage 2 Guided Review; any external ply/stage change cancels it cleanly.
  useEffect(() => {
    if (!autoPlay || reportStage !== "guided") {
      autoSteppingRef.current = false;
      return;
    }
    const s0 = useReview.getState();
    if (s0.ply >= s0.moves.length) {
      setAutoPlay(false);
      return;
    }
    const id = setInterval(() => {
      const s = useReview.getState();
      if (s.ply >= s.moves.length) {
        setAutoPlay(false);
        return;
      }
      autoSteppingRef.current = true;
      s.goTo(s.ply + 1);
    }, 950);
    return () => clearInterval(id);
  }, [autoPlay, reportStage]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel Auto-Play whenever ply/stage changes outside the timer.
  useEffect(() => {
    if (!autoPlay) return;
    if (autoSteppingRef.current) {
      autoSteppingRef.current = false;
      return;
    }
    setAutoPlay(false);
  }, [ply, reportStage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " && isInteractiveControl(e.target)) return;
      const s = useReview.getState();
      const map: Record<string, () => void> = {
        ArrowLeft: () => {
          stopAutoPlay();
          if (reportStage === "guided") seek(s.ply - 1);
        },
        ArrowRight: () => {
          stopAutoPlay();
          if (reportStage === "overview") enterGuided(s.ply === 0 ? 1 : s.ply + 1);
          else seek(s.ply + 1);
        },
        ArrowUp: () => {
          if (reportStage === "guided") seek(0);
        },
        Home: () => {
          if (reportStage === "guided") seek(0);
        },
        ArrowDown: () => {
          if (reportStage === "guided") seek(s.moves.length);
        },
        End: () => {
          if (reportStage === "guided") seek(s.moves.length);
        },
        " ": () => {
          stopAutoPlay();
          if (reportStage === "overview") {
            enterGuided(s.ply > 0 ? (nextKey ?? s.ply) : (keyPlies[0] ?? (s.moves.length > 0 ? 1 : 0)));
          } else if (nextKey !== undefined) {
            seek(nextKey);
          } else if (s.ply === 0 && keyPlies[0] !== undefined) {
            seek(keyPlies[0]);
          }
        },
        r: () => {
          if (reportStage === "guided" && move && RETRYABLE.has(move.classification) && !retry) {
            startRetry();
          }
        },
        R: () => {
          if (reportStage === "guided" && move && RETRYABLE.has(move.classification) && !retry) {
            startRetry();
          }
        },
        f: () => setOrientation(s.orientation === "white" ? "black" : "white"),
        F: () => setOrientation(s.orientation === "white" ? "black" : "white"),
        s: () => {
          if (reportStage === "overview") enterGuided();
          else goOverview();
        },
        S: () => {
          if (reportStage === "overview") enterGuided();
          else goOverview();
        },
        "?": () => setGuideOpen((v) => !v),
        Escape: () => {
          setPreview(null);
          setRetry(null);
          setAutoPlay(false);
        },
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    seek,
    enterGuided,
    goOverview,
    stopAutoPlay,
    reportStage,
    keyPlies,
    nextKey,
    move,
    retry,
    startRetry,
    setOrientation,
  ]);

  const markers = useMemo<GraphMarker[]>(
    () =>
      (review?.moves ?? [])
        .filter((m) => MARKED.has(m.classification))
        .map((m) => {
          const score = m.scoreAfter;
          return {
            index: m.ply,
            color: CLASS_META[m.classification].color,
            ringColor: CLASS_META[m.classification].ring,
            label: classLabel(m.classification),
            san: `${Math.ceil(m.ply / 2)}${m.color === "white" ? "." : "…"} ${formatSan(m.san, settings.notation, m.color)}`,
            ...(score ? { scoreLabel: formatScore(score) } : {}),
          };
        }),
    [review, classLabel, settings.notation],
  );

  const graphMeta = useMemo<(GraphPointMeta | undefined)[]>(() => {
    if (!review) return [];
    return [
      undefined,
      ...review.moves.map((m) => ({
        san: `${Math.ceil(m.ply / 2)}${m.color === "white" ? "." : "…"} ${formatSan(m.san, settings.notation, m.color)}`,
        ...(m.scoreAfter ? { scoreLabel: formatScore(m.scoreAfter) } : {}),
        classification: classLabel(m.classification),
      })),
    ];
  }, [review, settings.notation, classLabel]);

  const prevPlyRef = useRef(ply);
  const isBoardJump = Math.abs(ply - prevPlyRef.current) > 1 && !preview && !retry;
  useEffect(() => {
    prevPlyRef.current = ply;
  }, [ply]);

  if (!review || !meta) return null;

  const retrying = retry !== null;
  const before = move ? positions[move.ply - 1] : undefined;
  const after = move ? positions[move.ply] : undefined;
  const moveUci = move ? (moves[move.ply - 1]?.uci ?? "") : "";
  const reasons = move && before && after ? explainMove(move, before, after, moveUci, previousMove) : [];
  const motifShapes = showMotifs ? motifShapesForReasons(reasons) : [];

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
  const evalBarTarget = resolveReviewEvalBar({
    preview,
    shownIndex,
    before,
    after,
    positions,
    whiteWin: review.whiteWin,
  });

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
    shapes.push(...motifShapes);
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
      playSound("correct");
      setRetry({ ...retry, result: "correct", tried });
      return;
    }
    if ((node.uci ?? uci) === moves[retry.ply - 1]?.uci) {
      playSound("wrong");
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
      playSound(verdict === "wrong" ? "wrong" : "correct");
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

  const shareTarget = {
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
  };

  const footerActionClass = "max-md:min-h-10 max-md:gap-1 max-md:px-2 max-md:text-xs";

  const openInAnalysis = (targetPly: number, previewLine?: readonly string[]) => {
    try {
      useAnalysis.getState().loadPgn(pgn, {
        ply: targetPly,
        orientation,
        classes: review.moves.map((m) => m.classification),
        whiteWin: review.whiteWin,
        evalLines: positions,
        ...(previewLine?.length ? { previewLine } : {}),
      });
    } catch {
      // Allow navigation to proceed gracefully.
    }
  };

  if (reportStage === "overview") {
    const overviewPly = ply > 0 ? ply : Math.max(0, fens.length - 1);
    const overviewFen = fens[overviewPly] ?? boardFen;
    const overviewLastUci = overviewPly > 0 ? moves[overviewPly - 1]?.uci : undefined;
    const overviewPos = positionFromFen(overviewFen);
    const overviewEval = resolveReviewEvalBar({
      preview: null,
      shownIndex: overviewPly,
      before: undefined,
      after: undefined,
      positions,
      whiteWin: review.whiteWin,
    });
    const overviewMove = overviewPly > 0 ? review.moves[overviewPly - 1] : undefined;

    return (
      <TooltipProvider delayDuration={250}>
        <m.div
          key="overview"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden md:grid md:flex-initial md:grid-cols-[minmax(0,1fr)_minmax(23rem,31rem)] md:items-start md:gap-6 md:overflow-visible"
        >
          <div className="hidden min-w-0 space-y-2 md:block">
            <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-10rem),40rem)]">
              <PlayerBar
                player={orientation === "white" ? meta.black : meta.white}
                color={orientation === "white" ? "black" : "white"}
                accuracy={sideScore(orientation === "white" ? "black" : "white")}
                fen={overviewFen}
              />
              <div className="flex gap-2">
                <EvalBar
                  score={overviewEval.score}
                  whiteWin={overviewEval.whiteWin}
                  orientation={orientation}
                  className="w-7 shrink-0"
                />
                <div className="relative min-w-0 flex-1">
                  <ChessBoard
                    fen={overviewFen}
                    orientation={orientation}
                    turnColor={overviewPos.turn}
                    lastMove={toKeys(overviewLastUci)}
                    check={overviewPos.isCheck()}
                  >
                    {overviewMove && settings.reviewBadges && overviewLastUci && (
                      <SquareBadge
                        cls={overviewMove.classification}
                        square={badgeSquare(overviewLastUci, overviewMove.san)}
                        orientation={orientation}
                      />
                    )}
                  </ChessBoard>
                </div>
              </div>
              <PlayerBar
                player={orientation === "white" ? meta.white : meta.black}
                color={orientation}
                accuracy={sideScore(orientation)}
                fen={overviewFen}
              />
            </div>
            <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-10rem),40rem)]">
              <EvalGraph
                whiteWin={review.whiteWin}
                index={overviewPly}
                onSeek={(idx) => enterGuided(idx)}
                markers={markers}
                meta={graphMeta}
                compact
              />
            </div>
          </div>

          <section
            aria-label={t("tabs.summary")}
            className="panel-solid flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl md:max-h-[calc(100dvh-7rem)]"
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2 md:py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wider text-primary uppercase">
                  {t("overviewEyebrow")}
                </p>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h1 className="font-display text-2xl tracking-tight sm:text-3xl">{tImport("title")}</h1>
                  <span className="font-mono text-xs text-muted-foreground">
                    {meta.result} · {t("overviewMoves", { n: Math.ceil(moves.length / 2) })}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <ReviewOptions className="max-md:size-10" />
                <BoardSettings className="max-md:size-10" />
                <ReviewShortcutsGuideTrigger onClick={() => setGuideOpen(true)} className="max-md:size-10" />
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 px-4 pt-1.5 md:hidden">
                <MiniBoard
                  fen={overviewFen}
                  lastMove={toKeys(overviewLastUci)}
                  orientation={orientation}
                  label={t("preview")}
                  className="size-12 rounded-lg border border-border shadow-xs"
                />
                <EvalGraph
                  whiteWin={review.whiteWin}
                  index={overviewPly}
                  onSeek={(idx) => enterGuided(idx)}
                  markers={markers}
                  meta={graphMeta}
                  compact
                />
              </div>
              <ReviewSummary onSeek={(p) => enterGuided(p)} onStartReview={() => enterGuided()} />
            </div>

            <div className="mt-auto flex shrink-0 flex-wrap items-center gap-1 border-t px-2 py-1.5 md:gap-2 md:p-3">
              <Button variant="ghost" size="sm" className={footerActionClass} onClick={reset}>
                {t("newReview")}
              </Button>
              <ShareDialog triggerClassName={footerActionClass} target={shareTarget} />
              <Button variant="ghost" size="sm" className={footerActionClass} asChild>
                <Link href="/analysis" onClick={() => openInAnalysis(overviewPly)}>
                  <LineChart /> {t("analyzePosition")}
                </Link>
              </Button>
              {meta.url && (
                <Button variant="ghost" size="sm" className={footerActionClass} asChild>
                  <a href={meta.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> {t("original")}
                  </a>
                </Button>
              )}
            </div>
          </section>
          <ReviewShortcutsGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
        </m.div>
      </TooltipProvider>
    );
  }

  const summaryBlock = <ReviewSummary onSeek={seek} />;

  return (
    <TooltipProvider delayDuration={250}>
      <h1 className="sr-only">{tImport("title")}</h1>
      <m.div
        key="guided"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden md:grid md:flex-initial md:gap-4 md:overflow-visible lg:grid-cols-[minmax(0,1fr)_minmax(320px,23.5rem)] lg:grid-rows-[auto_1fr] lg:gap-x-4 lg:gap-y-2 xl:grid-cols-[minmax(15.5rem,17.5rem)_minmax(0,1fr)_minmax(300px,21rem)]"
      >
        <section
          aria-label={t("tabs.summary")}
          className="glass hidden max-h-[calc(100dvh-7rem)] self-start overflow-y-auto rounded-2xl xl:sticky xl:top-20 xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:block"
        >
          <h2 className="px-4 pt-4 text-sm font-semibold">{t("tabs.summary")}</h2>
          {summaryBlock}
        </section>

        <div className="min-w-0 shrink-0 lg:col-start-1 lg:row-start-1 xl:col-start-2">
          <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-23.5rem))] md:max-w-[min(100%,calc(100dvh-7.75rem),42.75rem)]">
            <PlayerBar
              player={orientation === "white" ? meta.black : meta.white}
              color={orientation === "white" ? "black" : "white"}
              accuracy={sideScore(orientation === "white" ? "black" : "white")}
              fen={boardFen}
            />
            <div className="flex gap-1.5 md:gap-2">
              <EvalBar
                score={evalBarTarget.score}
                whiteWin={evalBarTarget.whiteWin}
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
                  animationMs={isBoardJump ? 0 : undefined}
                  interactionMode={retrying ? "play" : boardMode}
                  onSwipe={(dir) => seek(dir === "next" ? ply + 1 : ply - 1)}
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
          className="flex shrink-0 flex-nowrap items-center gap-0.5 rounded-xl border bg-card/90 p-1 shadow-sm backdrop-blur-xl lg:hidden"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("start")}
            onClick={() => seek(0)}
          >
            <ChevronFirst />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("previous")}
            onClick={() => seek(ply - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant={autoPlay ? "secondary" : "ghost"}
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={autoPlay ? t("pauseAutoPlay") : t("autoPlay")}
            aria-pressed={autoPlay}
            disabled={retrying || (!autoPlay && ply >= review.moves.length)}
            onClick={toggleAutoPlay}
          >
            {autoPlay ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("next")}
            onClick={() => seek(ply + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("end")}
            onClick={() => seek(review.moves.length)}
          >
            <ChevronLast />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
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
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("flip")}
            onClick={() => setOrientation(orientation === "white" ? "black" : "white")}
          >
            <FlipVertical2 />
          </Button>
          <BoardModeToggles
            mode={boardMode}
            onModeChange={setBoardMode}
            buttonClassName="h-10 min-w-0 flex-1 px-0"
          />
        </nav>

        <div className="min-w-0 shrink-0 space-y-2 self-stretch md:self-start lg:col-start-1 lg:row-start-2 xl:col-start-2">
          <EvalGraph
            whiteWin={review.whiteWin}
            index={ply}
            onSeek={seek}
            markers={markers}
            meta={graphMeta}
            compact
          />
          <div className="hidden flex-wrap items-center justify-center gap-1 lg:flex">
            <HintTooltip label={t("start")} shortcut="↑">
              <Button variant="ghost" size="icon" aria-label={t("start")} onClick={() => seek(0)}>
                <ChevronFirst />
              </Button>
            </HintTooltip>
            <HintTooltip label={t("previous")} shortcut="←">
              <Button variant="ghost" size="icon" aria-label={t("previous")} onClick={() => seek(ply - 1)}>
                <ChevronLeft />
              </Button>
            </HintTooltip>
            <HintTooltip
              label={autoPlay ? t("pauseAutoPlay") : t("autoPlay")}
              description={t("autoPlayHint")}
            >
              <Button
                variant={autoPlay ? "secondary" : "ghost"}
                size="icon"
                aria-label={autoPlay ? t("pauseAutoPlay") : t("autoPlay")}
                aria-pressed={autoPlay}
                disabled={retrying || (!autoPlay && ply >= review.moves.length)}
                onClick={toggleAutoPlay}
              >
                {autoPlay ? <Pause /> : <Play />}
              </Button>
            </HintTooltip>
            <HintTooltip label={t("next")} shortcut="→">
              <Button variant="ghost" size="icon" aria-label={t("next")} onClick={() => seek(ply + 1)}>
                <ChevronRight />
              </Button>
            </HintTooltip>
            <HintTooltip label={t("end")} shortcut="↓">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("end")}
                onClick={() => seek(review.moves.length)}
              >
                <ChevronLast />
              </Button>
            </HintTooltip>
            <HintTooltip label={t("nextKey")} shortcut="Space">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("nextKey")}
                disabled={nextKey === undefined}
                onClick={() => nextKey !== undefined && seek(nextKey)}
              >
                <ChevronsRight />
              </Button>
            </HintTooltip>
            <HintTooltip label={t("flip")} shortcut="F">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("flip")}
                onClick={() => setOrientation(orientation === "white" ? "black" : "white")}
              >
                <FlipVertical2 />
              </Button>
            </HintTooltip>
            <ReviewOptions />
            <BoardSettings />
          </div>
        </div>

        <aside className="panel-solid flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl md:flex-initial md:self-start lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-7rem)] xl:col-start-3">
          <div className="flex shrink-0 items-center justify-between gap-1 border-b px-1.5 py-0.5 md:hidden">
            <div
              role="tablist"
              aria-label={t("tabs.drawer")}
              className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
            >
              {(
                [
                  ["guide", t("tabs.guide"), "tactical-guide"],
                  ["moves", t("tabs.moves"), "review-panel-moves"],
                  ["summary", t("tabs.summary"), "review-panel-summary"],
                ] as const
              ).map(([id, label, panelId]) => {
                const selected = mobileTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`review-tab-${id}`}
                    aria-selected={selected}
                    aria-controls={selected ? panelId : undefined}
                    onClick={() => setMobileTab(id)}
                    className={cn(
                      "relative min-h-10 shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition",
                      selected
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                    {selected && (
                      <m.span
                        layoutId={reduceMotion ? undefined : "review-tab-pill"}
                        aria-hidden
                        transition={{ type: "spring", stiffness: 520, damping: 38 }}
                        className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <ReviewOptions className="size-10" />
              <BoardSettings className="size-10" />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col max-md:overflow-hidden md:overflow-y-auto xl:overflow-hidden">
            <div
              id="tactical-guide"
              className={cn(
                "min-h-0 border-b max-md:flex-1 max-md:overflow-y-auto md:block md:shrink-0 xl:max-h-80 xl:overflow-y-auto",
                mobileTab !== "guide" && "max-md:hidden",
              )}
            >
              <CoachCard
                move={move}
                previous={previousMove}
                retry={retry}
                setRetry={setRetry}
                preview={preview}
                setPreview={setPreview}
                showMotifs={showMotifs}
                onToggleMotifs={() => setShowMotifs(!showMotifs)}
                onRetryStart={startRetry}
                onNextKey={() => nextKey !== undefined && seek(nextKey)}
                hasNextKey={nextKey !== undefined}
              />
            </div>

            <div
              id="review-panel-moves"
              className={cn(
                "min-h-0 max-md:flex max-md:flex-1 max-md:flex-col max-md:overflow-hidden md:block md:shrink-0 xl:flex xl:shrink xl:flex-col xl:overflow-hidden",
                mobileTab !== "moves" && "max-md:hidden",
              )}
            >
              <MoveTable
                onSeek={seek}
                scrollTrigger={mobileTab}
                className="max-md:flex-1 max-md:border-b-0 xl:flex-1"
              />
            </div>

            <div
              id="review-panel-summary"
              className={cn(
                "min-h-0 max-md:flex-1 max-md:overflow-y-auto md:shrink-0 xl:hidden",
                mobileTab !== "summary" && "max-md:hidden",
              )}
            >
              <h2 className="px-4 pt-3 text-sm font-semibold">{t("tabs.summary")}</h2>
              {summaryBlock}
            </div>
          </div>

          <div className="mt-auto flex shrink-0 flex-wrap items-center gap-1 border-t px-1.5 py-1 md:gap-2 md:p-3">
            <HintTooltip label={t("backToSummary")} shortcut="S">
              <Button variant="secondary" size="sm" className={footerActionClass} onClick={goOverview}>
                {t("backToSummary")}
              </Button>
            </HintTooltip>
            <Button variant="ghost" size="sm" className={footerActionClass} onClick={reset}>
              {t("newReview")}
            </Button>
            <ShareDialog triggerClassName={footerActionClass} target={shareTarget} />
            <Button variant="ghost" size="sm" className={footerActionClass} asChild>
              <Link
                href="/analysis"
                onClick={() => {
                  if (retrying) {
                    openInAnalysis(Math.max(0, retry.ply - 1));
                  } else if (preview && move) {
                    const from = preview.line === "best" ? move.ply - 1 : move.ply;
                    const line = ((preview.line === "best" ? before : after)?.lines[0]?.pv ?? []).slice(
                      0,
                      preview.plies,
                    );
                    openInAnalysis(from, line);
                  } else {
                    openInAnalysis(ply);
                  }
                }}
              >
                <LineChart /> {t("analyzePosition")}
              </Link>
            </Button>
            {meta.url && (
              <Button variant="ghost" size="sm" className={footerActionClass} asChild>
                <a href={meta.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> {t("original")}
                </a>
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1">
              <div className="hidden items-center gap-1 md:flex lg:hidden">
                <ReviewOptions />
                <BoardSettings />
              </div>
              <ReviewShortcutsGuideTrigger
                onClick={() => setGuideOpen(true)}
                showKeyPill
                className="max-md:min-h-10"
              />
            </div>
          </div>
        </aside>
        <ReviewShortcutsGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
      </m.div>
    </TooltipProvider>
  );
}
