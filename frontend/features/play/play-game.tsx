// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { botById, positionFromFen, treeToPgn } from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import {
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Copy,
  Flag,
  Lightbulb,
  Loader2,
  RotateCcw,
  Trophy,
  Undo2,
  X,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { Captured } from "@/features/review/material";
import { useReview } from "@/features/review/review-store";
import { ShareDialog } from "@/features/share/share-dialog";
import { shareTargetFromPgn } from "@/features/share/share-target";
import { formatSan } from "@/lib/notation";
import { scrollChildIntoContainer } from "@/lib/scroll-container";
import { useSettings } from "@/lib/settings-store";
import { playSound } from "@/lib/sounds";
import { usePrefersReducedMotion } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import { BotPlayer } from "./bot-player";
import { buildPlayHistoryRows, resolvePlayView } from "./play-history";
import { usePlay } from "./play-store";

const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;

/** Game-end reasons (chess-core / play-store values) → message keys under play.reasons. */
const REASON_KEY: Record<string, string> = {
  checkmate: "checkmate",
  stalemate: "stalemate",
  "insufficient material": "insufficient",
  "threefold repetition": "threefold",
  "fifty-move rule": "fiftyMove",
  resignation: "resignation",
  timeout: "timeout",
};

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null)
  );
}

function formatClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return s.toFixed(1);
  const mins = Math.floor(s / 60);
  return `${mins}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function Clock({ ms, active }: { ms: number; active: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-lg px-2.5 py-0.5 font-mono text-base tabular-nums md:px-3 md:py-1 md:text-lg",
        active ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
        active && ms < 20_000 && "bg-destructive text-white",
      )}
    >
      {formatClock(ms)}
    </span>
  );
}

export function PlayGame() {
  const s = usePlay();
  const notation = useSettings((st) => st.notation);
  const t = useTranslations("play");
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotion();
  const bot = botById(s.botId);
  const player = useRef<BotPlayer | null>(null);
  const api = useRef<Api | null>(null);
  const moveScrollerRef = useRef<HTMLDivElement>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const viewPly = s.viewPly;
  const setViewPly = s.setViewPly;
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [sideTab, setSideTab] = useState<"moves" | "info">("moves");
  const [copiedFen, setCopiedFen] = useState(false);

  const { nodes: allNodes, rows: moveRows } = useMemo(
    () => buildPlayHistoryRows(s.tree, s.path),
    [s.tree, s.path],
  );
  const { livePly, effectivePly, viewingHistory, liveNode, shownNode } = useMemo(
    () => resolvePlayView(allNodes, s.tree.root, viewPly),
    [allNodes, s.tree.root, viewPly],
  );

  const livePos = useMemo(() => positionFromFen(liveNode.fen), [liveNode.fen]);
  const shownPos = useMemo(() => positionFromFen(shownNode.fen), [shownNode.fen]);
  const botColor = s.playerColor === "white" ? "black" : "white";
  const botToMove = s.stage === "playing" && livePos.turn === botColor;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  useEffect(() => {
    player.current = new BotPlayer();
    return () => {
      player.current?.destroy();
      player.current = null;
    };
  }, []);

  // Normalize /play?fen=... -> /play once a game is active so reloading restores the game instead of setup.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("fen=")) {
      try {
        window.history.replaceState(null, "", "/play");
      } catch {
        // ignore
      }
    }
  }, []);

  // Reset overlay dismissal when a new game starts or game-over resets.
  const prevTreeRef = useRef(s.tree);
  useEffect(() => {
    if (prevTreeRef.current !== s.tree) {
      prevTreeRef.current = s.tree;
      setOverlayDismissed(false);
    }
  }, [s.tree]);

  // Ensure the post-game overlay shows and any pending promotion clears when a game ends.
  useEffect(() => {
    if (s.over) {
      setOverlayDismissed(false);
      setPromotion(null);
    }
  }, [s.over]);

  // Bot's turn: always compute against the live head position, even if the user previews history.
  useEffect(() => {
    if (!botToMove || !bot || !player.current) return;
    const controller = new AbortController();
    setThinking(true);
    const pause = bot.level.method === "max" ? 150 : 350 + Math.random() * 650;
    const started = Date.now();
    player.current
      .chooseMove(liveNode.fen, s.path.length, bot, controller.signal)
      .then((move) => {
        if (controller.signal.aborted || !move) return;
        const wait = Math.max(0, pause - (Date.now() - started));
        setTimeout(() => {
          if (!controller.signal.aborted) usePlay.getState().move(move.uci);
        }, wait);
      })
      .catch(() => undefined)
      .finally(() => setThinking(false));
    return () => controller.abort();
  }, [botToMove, liveNode.fen, bot, s.path.length]);

  // Execute a queued premove cleanly as soon as turn control returns to the player at live head.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveNode.fen triggers after ChessBoard applies the new position.
  useEffect(() => {
    if (s.stage === "playing" && livePos.turn === s.playerColor && !promotion && !viewingHistory) {
      api.current?.playPremove();
    }
  }, [s.stage, livePos.turn, s.playerColor, promotion, viewingHistory, liveNode.fen]);

  // Cancel any stale premove highlight if the game ends, user previews history, or takes back a move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: s.takebacks clears pending premove on takeback.
  useEffect(() => {
    if (s.stage !== "playing" || viewingHistory) {
      api.current?.cancelPremove();
    }
  }, [s.stage, viewingHistory, s.takebacks]);

  // Clocks.
  useEffect(() => {
    if (s.stage !== "playing" || !s.tc.baseMs) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [s.stage, s.tc.baseMs]);
  const remaining = (color: "white" | "black") =>
    s.clocks[color] -
    (s.turnStartedAt && livePos.turn === color && s.stage === "playing" ? now - s.turnStartedAt : 0);
  useEffect(() => {
    if (s.stage !== "playing" || !s.tc.baseMs) return;
    if (remaining(livePos.turn) <= 0) usePlay.getState().flag(livePos.turn);
  });
  // One warning beep when the player's clock drops under 10 seconds.
  const warned = useRef(false);
  const mine = s.tc.baseMs ? remaining(s.playerColor) : Number.POSITIVE_INFINITY;
  useEffect(() => {
    if (s.stage !== "playing" || mine > 10_000) {
      if (mine > 10_000) warned.current = false;
      return;
    }
    if (!warned.current && mine > 0) {
      warned.current = true;
      playSound("lowTime");
    }
  }, [mine, s.stage]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the hint whenever the live position changes.
  useEffect(() => setHint(null), [liveNode.fen]);

  // Keep active move button centered inside the move list container without scrolling outer document.
  // biome-ignore lint/correctness/useExhaustiveDependencies: livePly ensures scrolling to newly played moves.
  useEffect(() => {
    const el = moveScrollerRef.current?.querySelector<HTMLElement>(`[data-ply="${effectivePly}"]`);
    scrollChildIntoContainer(moveScrollerRef.current, el);
  }, [effectivePly, livePly]);

  const goFirst = useCallback(() => {
    if (livePly > 0) setViewPly(0);
  }, [livePly, setViewPly]);
  const goPrev = useCallback(() => {
    const cur = viewPly === null ? livePly : viewPly;
    setViewPly(cur > 0 ? cur - 1 : 0);
  }, [livePly, viewPly, setViewPly]);
  const goNext = useCallback(() => {
    if (viewPly === null) return;
    const next = viewPly + 1;
    setViewPly(next >= livePly ? null : next);
  }, [livePly, viewPly, setViewPly]);
  const goLast = useCallback(() => setViewPly(null), [setViewPly]);

  // Keyboard navigation across move history (`←`, `→`, `Home`, `End`).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || promotion) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Home") {
        e.preventDefault();
        goFirst();
      } else if (e.key === "End") {
        e.preventDefault();
        goLast();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [promotion, goFirst, goPrev, goNext, goLast]);

  const dests = useMemo(
    () =>
      s.stage === "playing" && !viewingHistory && livePos.turn === s.playerColor && !promotion
        ? (chessgroundDests(livePos) as Map<Key, Key[]>)
        : new Map<Key, Key[]>(),
    [livePos, s.stage, viewingHistory, s.playerColor, promotion],
  );
  const lastMove = shownNode.uci
    ? ([shownNode.uci.slice(0, 2), shownNode.uci.slice(2, 4)] as Key[])
    : undefined;
  const shapes: DrawShape[] =
    s.stage === "playing" && hint && !viewingHistory
      ? [{ orig: hint.slice(0, 2) as Key, dest: hint.slice(2, 4) as Key, brush: "green" }]
      : [];

  const askHint = async () => {
    if (!player.current || botToMove || viewingHistory) return;
    usePlay.getState().useHint();
    const controller = new AbortController();
    try {
      const best = await player.current.hint(liveNode.fen, controller.signal);
      if (best) setHint(best);
    } catch {
      // Ignore engine failure on hint request.
    }
  };

  const review = () => {
    const wElo = Number(s.tree.headers.get("WhiteElo"));
    const bElo = Number(s.tree.headers.get("BlackElo"));
    const botElo = bot?.level.elo ?? null;
    useReview.getState().start(treeToPgn(s.tree), {
      white: {
        name: s.tree.headers.get("White") ?? "White",
        rating: Number.isFinite(wElo) && wElo > 0 ? wElo : s.playerColor === "black" ? botElo : null,
      },
      black: {
        name: s.tree.headers.get("Black") ?? "Black",
        rating: Number.isFinite(bElo) && bElo > 0 ? bElo : s.playerColor === "white" ? botElo : null,
      },
      result: s.over?.result ?? "*",
      me: s.playerColor,
    });
    router.push("/review");
  };

  const playerWon =
    s.over && s.over.result !== "1/2-1/2" && (s.over.result === "1-0") === (s.playerColor === "white");
  const isDraw = s.over?.result === "1/2-1/2";

  const botBar = bot && (
    <div className="flex items-center justify-between gap-2 py-1 md:py-2">
      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
        <BotAvatar bot={bot} className="size-9" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="truncate text-sm font-semibold">{bot.name}</p>
            <Captured fen={shownNode.fen} color={botColor} />
          </div>
          <p className="text-xs text-muted-foreground">
            {thinking ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" /> {t("thinking")}
              </span>
            ) : bot.level.method === "max" ? (
              t("fullStrength")
            ) : (
              `~${bot.level.elo}`
            )}
          </p>
        </div>
      </div>
      {s.tc.baseMs && (
        <Clock ms={remaining(botColor)} active={s.stage === "playing" && livePos.turn === botColor} />
      )}
    </div>
  );
  const youBar = (
    <div className="flex items-center justify-between gap-2 py-1 md:py-2">
      <div className="flex min-w-0 items-center gap-2">
        <p className="text-sm font-semibold">{t("you")}</p>
        <Captured fen={shownNode.fen} color={s.playerColor} />
      </div>
      {s.tc.baseMs && (
        <Clock
          ms={remaining(s.playerColor)}
          active={s.stage === "playing" && livePos.turn === s.playerColor}
        />
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden md:grid md:flex-initial md:gap-6 md:overflow-visible lg:grid-cols-[minmax(0,1fr)_minmax(300px,22rem)]">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-20rem))] shrink-0 md:max-w-[min(100%,calc(100dvh-14rem))]">
          {botBar}
          <div className="relative">
            <ChessBoard
              sound
              fen={shownNode.fen}
              orientation={s.playerColor}
              turnColor={shownPos.turn}
              lastMove={lastMove}
              check={shownPos.isCheck()}
              dests={dests}
              movableColor={s.stage === "playing" && !viewingHistory ? s.playerColor : undefined}
              premovable={s.stage === "playing" && !promotion && !viewingHistory}
              autoShapes={shapes}
              onReady={(a) => {
                api.current = a;
              }}
              onMove={(orig, dest) => {
                if (viewingHistory) return;
                const sq = (orig.charCodeAt(1) - 49) * 8 + (orig.charCodeAt(0) - 97);
                if (livePos.board.get(sq)?.role === "pawn" && (dest[1] === "8" || dest[1] === "1")) {
                  setPromotion({ orig, dest });
                  return;
                }
                if (!usePlay.getState().move(orig + dest)) api.current?.set({ fen: liveNode.fen });
              }}
            >
              {promotion && s.stage === "playing" && (
                <PromotionPicker
                  color={livePos.turn}
                  onPick={(role) => {
                    usePlay.getState().move(promotion.orig + promotion.dest + ROLE_CHAR[role]);
                    setPromotion(null);
                  }}
                  onCancel={() => {
                    setPromotion(null);
                    api.current?.set({ fen: liveNode.fen });
                  }}
                />
              )}
            </ChessBoard>
            {viewingHistory && (
              <div className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1.5">
                <span className="rounded-md border bg-popover/95 px-2 py-0.5 text-xs font-medium text-popover-foreground shadow">
                  {t("previewBadge")}
                </span>
              </div>
            )}
            <AnimatePresence>
              {s.over && !overlayDismissed && (
                <m.div
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
                  className="absolute inset-x-3 top-1/2 z-20 max-h-[calc(100%-0.75rem)] -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover/95 p-4 text-center shadow-2xl backdrop-blur md:inset-x-6 md:p-6"
                >
                  <button
                    type="button"
                    aria-label={t("dismissOverlay")}
                    onClick={() => setOverlayDismissed(true)}
                    className="absolute top-2.5 right-2.5 rounded-lg p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                  <div className="mb-2 flex justify-center">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 font-mono text-xs font-semibold",
                        isDraw
                          ? "bg-secondary text-foreground"
                          : playerWon
                            ? "bg-primary/15 text-primary"
                            : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {playerWon && <Trophy className="size-3.5" aria-hidden />}
                      {s.over.result}
                    </span>
                  </div>
                  <p className="font-display text-3xl md:text-4xl">
                    {isDraw
                      ? t("draw")
                      : playerWon
                        ? t("youWon")
                        : t("botWon", { name: bot?.name ?? t("bot") })}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {REASON_KEY[s.over.reason]
                      ? t(`reasons.${REASON_KEY[s.over.reason]}` as never)
                      : s.over.reason}
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2 md:mt-5">
                    {s.path.length >= 2 && <Button onClick={review}>{t("review")}</Button>}
                    <Button variant="secondary" onClick={() => s.start(s.playerColor)}>
                      <RotateCcw /> {t("rematch")}
                    </Button>
                    <Button variant="ghost" onClick={s.newGame}>
                      {t("newOpponent")}
                    </Button>
                    {s.path.length > 0 && (
                      <ShareDialog
                        target={shareTargetFromPgn(treeToPgn(s.tree), { orientation: s.playerColor })}
                      />
                    )}
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </div>
          {youBar}
        </div>

        <aside className="panel-solid flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-2xl p-2.5 md:flex-initial md:gap-3 md:p-4">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b pb-1.5">
            <div role="tablist" aria-label={t("moves")} className="flex gap-1">
              {(["moves", "info"] as const).map((id) => {
                const selected = sideTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSideTab(id)}
                    className={cn(
                      "relative rounded-md px-2.5 py-1 text-xs font-medium transition",
                      selected
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`tabs.${id}`)}
                    {selected && (
                      <m.span
                        layoutId={reduceMotion ? undefined : "play-tab-pill"}
                        aria-hidden
                        transition={{ type: "spring", stiffness: 520, damping: 38 }}
                        className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div role="toolbar" aria-label={t("moves")} className="flex items-center gap-0.5">
              <HintTooltip label={t("first")} shortcut="Home">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("first")}
                  disabled={effectivePly <= 0}
                  onClick={goFirst}
                >
                  <ChevronFirst className="size-4" />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("previous")} shortcut="←">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("previous")}
                  disabled={effectivePly <= 0}
                  onClick={goPrev}
                >
                  <ChevronLeft className="size-4" />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("next")} shortcut="→">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("next")}
                  disabled={!viewingHistory}
                  onClick={goNext}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("last")} shortcut="End">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("last")}
                  disabled={!viewingHistory}
                  onClick={goLast}
                >
                  <ChevronLast className="size-4" />
                </Button>
              </HintTooltip>
            </div>
            <div className="flex items-center gap-1.5">
              {viewingHistory && (
                <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={goLast}>
                  {t("returnLive")}
                </Button>
              )}
              {s.over && overlayDismissed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setOverlayDismissed(false)}
                >
                  {t("showResult")}
                </Button>
              )}
            </div>
          </div>

          {sideTab === "info" ? (
            <div className="surface-well min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl p-3 text-xs md:max-h-72 lg:max-h-[46vh]">
              <dl className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t("tabs.opponent")}</dt>
                  <dd className="font-medium">
                    {bot?.name ?? t("bot")} (
                    {bot?.level.method === "max" ? t("setup.max") : `~${bot?.level.elo}`})
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t("tabs.timeControl")}</dt>
                  <dd className="font-mono">{s.tc.id === "none" ? t("setup.noClock") : s.tc.label}</dd>
                </div>
              </dl>
              <div className="space-y-1.5 border-t pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-muted-foreground">FEN</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shownNode.fen);
                        setCopiedFen(true);
                        setTimeout(() => setCopiedFen(false), 1500);
                      } catch {
                        setCopiedFen(false);
                      }
                    }}
                    className="inline-flex min-h-6 items-center gap-1 rounded-md border bg-secondary/70 px-2 py-0.5 font-medium transition hover:border-primary/40"
                  >
                    {copiedFen ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
                    {copiedFen ? t("tabs.copied") : t("tabs.copyFen")}
                  </button>
                </div>
                <p className="overflow-x-auto whitespace-nowrap rounded-lg border bg-background/70 px-2 py-1 font-mono text-[11px]">
                  {shownNode.fen}
                </p>
              </div>
            </div>
          ) : (
            <div
              ref={moveScrollerRef}
              className="surface-well min-h-0 flex-1 overflow-y-auto rounded-xl p-2 font-mono text-sm md:max-h-72 lg:max-h-[46vh]"
            >
              {moveRows.length === 0 ? (
                <p className="p-2 font-sans text-muted-foreground">
                  {livePos.turn === s.playerColor
                    ? t("youOpen")
                    : t("botOpens", { name: bot?.name ?? t("bot") })}
                </p>
              ) : (
                <ol className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-1.5 gap-y-0.5">
                  {moveRows.map((row) => (
                    <li key={row.moveNo} className="contents">
                      <span className="py-0.5 text-muted-foreground">{row.moveNo}.</span>
                      {row.white ? (
                        <button
                          type="button"
                          data-ply={row.white.plyIndex}
                          aria-current={effectivePly === row.white.plyIndex ? "true" : undefined}
                          onClick={() =>
                            setViewPly(row.white?.plyIndex === livePly ? null : (row.white?.plyIndex ?? null))
                          }
                          className={cn(
                            "rounded px-1.5 py-0.5 text-left transition hover:bg-accent",
                            effectivePly === row.white.plyIndex &&
                              "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                          )}
                        >
                          {formatSan(row.white.san, notation, "white")}
                        </button>
                      ) : (
                        <span className="px-1.5 py-0.5 text-muted-foreground">…</span>
                      )}
                      {row.black ? (
                        <button
                          type="button"
                          data-ply={row.black.plyIndex}
                          aria-current={effectivePly === row.black.plyIndex ? "true" : undefined}
                          onClick={() =>
                            setViewPly(row.black?.plyIndex === livePly ? null : (row.black?.plyIndex ?? null))
                          }
                          className={cn(
                            "rounded px-1.5 py-0.5 text-left transition hover:bg-accent",
                            effectivePly === row.black.plyIndex &&
                              "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                          )}
                        >
                          {formatSan(row.black.san, notation, "black")}
                        </button>
                      ) : (
                        <span />
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <div className="flex shrink-0 items-center gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto md:flex-wrap md:gap-2">
            <HintTooltip label={t("hint")} description={t("hintDesc")}>
              <Button
                variant="secondary"
                className="min-h-10 md:min-h-9"
                disabled={s.stage !== "playing" || botToMove || viewingHistory}
                onClick={askHint}
              >
                <Lightbulb /> {t("hint")}
              </Button>
            </HintTooltip>
            <HintTooltip label={t("takeback")} description={t("takebackDesc")}>
              <Button
                variant="secondary"
                className="min-h-10 md:min-h-9"
                disabled={s.stage !== "playing" || botToMove || s.path.length === 0}
                onClick={() => {
                  setViewPly(null);
                  s.takeback();
                }}
              >
                <Undo2 /> {t("takeback")}
              </Button>
            </HintTooltip>
            <HintTooltip label={t("resign")} description={t("resignDesc")}>
              <Button
                variant="ghost"
                className="min-h-10 md:min-h-9"
                disabled={s.stage !== "playing"}
                onClick={s.resign}
              >
                <Flag /> {t("resign")}
              </Button>
            </HintTooltip>
            <BoardSettings className="min-h-10 min-w-10 md:min-h-9 md:min-w-9" />
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            {t("usage", { hints: s.hints, takebacks: s.takebacks })}
            {s.stage === "playing" && !viewingHistory ? ` · ${t("premoveHint")}` : ""}
          </p>
        </aside>
      </div>
    </TooltipProvider>
  );
}
