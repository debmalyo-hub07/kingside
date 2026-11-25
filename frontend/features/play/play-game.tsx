// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { botById, nodeAtPath, nodesAlongPath, positionFromFen, treeToPgn } from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import { Flag, Lightbulb, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import { useReview } from "@/features/review/review-store";
import { ShareDialog } from "@/features/share/share-dialog";
import { shareTargetFromPgn } from "@/features/share/share-target";
import { formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import { BotPlayer } from "./bot-player";
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

function formatClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return s.toFixed(1);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function Clock({ ms, active }: { ms: number; active: boolean }) {
  return (
    <span
      className={cn(
        "rounded-lg px-3 py-1 font-mono text-lg tabular-nums",
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
  const bot = botById(s.botId);
  const player = useRef<BotPlayer | null>(null);
  const api = useRef<Api | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const node = nodeAtPath(s.tree, s.path) ?? s.tree.root;
  const pos = useMemo(() => positionFromFen(node.fen), [node.fen]);
  const botColor = s.playerColor === "white" ? "black" : "white";
  const botToMove = s.stage === "playing" && pos.turn === botColor;

  useEffect(() => {
    player.current = new BotPlayer();
    return () => {
      player.current?.destroy();
      player.current = null;
    };
  }, []);

  // Bot's turn: think (with a short human-like pause), then move.
  useEffect(() => {
    if (!botToMove || !bot || !player.current) return;
    const controller = new AbortController();
    setThinking(true);
    const pause = bot.level.method === "max" ? 150 : 350 + Math.random() * 650;
    const started = Date.now();
    player.current
      .chooseMove(node.fen, s.path.length, bot, controller.signal)
      .then((m) => {
        if (controller.signal.aborted || !m) return;
        const wait = Math.max(0, pause - (Date.now() - started));
        setTimeout(() => {
          if (!controller.signal.aborted) usePlay.getState().move(m.uci);
        }, wait);
      })
      .catch(() => undefined)
      .finally(() => setThinking(false));
    return () => controller.abort();
  }, [botToMove, node.fen, bot, s.path.length]);

  // Clocks.
  useEffect(() => {
    if (s.stage !== "playing" || !s.tc.baseMs) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [s.stage, s.tc.baseMs]);
  const remaining = (color: "white" | "black") =>
    s.clocks[color] -
    (s.turnStartedAt && pos.turn === color && s.stage === "playing" ? now - s.turnStartedAt : 0);
  useEffect(() => {
    if (s.stage !== "playing" || !s.tc.baseMs) return;
    if (remaining(pos.turn) <= 0) usePlay.getState().flag(pos.turn);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the hint whenever the position changes.
  useEffect(() => setHint(null), [node.fen]);

  const dests = useMemo(
    () =>
      s.stage === "playing" && pos.turn === s.playerColor && !promotion
        ? (chessgroundDests(pos) as Map<Key, Key[]>)
        : new Map<Key, Key[]>(),
    [pos, s.stage, s.playerColor, promotion],
  );
  const lastMove = node.uci ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as Key[]) : undefined;
  const shapes: DrawShape[] = hint
    ? [{ orig: hint.slice(0, 2) as Key, dest: hint.slice(2, 4) as Key, brush: "green" }]
    : [];

  const askHint = async () => {
    if (!player.current || botToMove) return;
    usePlay.getState().useHint();
    const controller = new AbortController();
    try {
      const best = await player.current.hint(node.fen, controller.signal);
      if (best) setHint(best);
    } catch {
      // Ignore engine failure on hint request.
    }
  };

  const review = () => {
    useReview.getState().start(treeToPgn(s.tree), {
      white: { name: s.tree.headers.get("White") ?? "White", rating: null },
      black: { name: s.tree.headers.get("Black") ?? "Black", rating: null },
      result: s.over?.result ?? "*",
      me: s.playerColor,
    });
    router.push("/review");
  };

  const moves = nodesAlongPath(s.tree, s.path).slice(1);
  const playerWon =
    s.over && s.over.result !== "1/2-1/2" && (s.over.result === "1-0") === (s.playerColor === "white");

  const botBar = bot && (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-3">
        <BotAvatar bot={bot} className="size-9" />
        <div>
          <p className="text-sm font-semibold">{bot.name}</p>
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
        <Clock ms={remaining(botColor)} active={s.stage === "playing" && pos.turn === botColor} />
      )}
    </div>
  );
  const youBar = (
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="text-sm font-semibold">{t("you")}</p>
      {s.tc.baseMs && (
        <Clock ms={remaining(s.playerColor)} active={s.stage === "playing" && pos.turn === s.playerColor} />
      )}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,22rem)]">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-14rem))]">
        {botBar}
        <div className="relative">
          <ChessBoard
            sound
            fen={node.fen}
            orientation={s.playerColor}
            turnColor={pos.turn}
            lastMove={lastMove}
            check={pos.isCheck()}
            dests={dests}
            autoShapes={shapes}
            onReady={(a) => {
              api.current = a;
            }}
            onMove={(orig, dest) => {
              const sq = (orig.charCodeAt(1) - 49) * 8 + (orig.charCodeAt(0) - 97);
              if (pos.board.get(sq)?.role === "pawn" && (dest[1] === "8" || dest[1] === "1")) {
                setPromotion({ orig, dest });
                return;
              }
              if (!usePlay.getState().move(orig + dest)) api.current?.set({ fen: node.fen });
            }}
          >
            {promotion && (
              <PromotionPicker
                color={pos.turn}
                onPick={(role) => {
                  usePlay.getState().move(promotion.orig + promotion.dest + ROLE_CHAR[role]);
                  setPromotion(null);
                }}
                onCancel={() => {
                  setPromotion(null);
                  api.current?.set({ fen: node.fen });
                }}
              />
            )}
          </ChessBoard>
          <AnimatePresence>
            {s.over && (
              <m.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-2xl border bg-popover/95 p-6 text-center shadow-2xl backdrop-blur"
              >
                <p className="font-display text-4xl">
                  {s.over.result === "1/2-1/2"
                    ? t("draw")
                    : playerWon
                      ? t("youWon")
                      : t("botWon", { name: bot?.name ?? t("bot") })}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {s.over.result} ·{" "}
                  {REASON_KEY[s.over.reason]
                    ? t(`reasons.${REASON_KEY[s.over.reason]}` as never)
                    : s.over.reason}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
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

      <aside className="glass flex flex-col gap-4 rounded-2xl p-4">
        <div className="max-h-72 overflow-y-auto rounded-xl bg-secondary/40 p-2 font-mono text-sm lg:max-h-[50vh]">
          {moves.length === 0 ? (
            <p className="p-2 font-sans text-muted-foreground">
              {s.playerColor === "white" ? t("youOpen") : t("botOpens", { name: bot?.name ?? t("bot") })}
            </p>
          ) : (
            <ol className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-0.5">
              {moves.map((m, i) =>
                m.ply % 2 === 1 || i === 0 ? (
                  <li key={m.id} className="contents">
                    <span className="text-muted-foreground">{Math.ceil(m.ply / 2)}.</span>
                    <span>{m.ply % 2 === 1 ? formatSan(m.san ?? "", notation, "white") : "…"}</span>
                    <span>
                      {m.ply % 2 === 1
                        ? formatSan(moves[i + 1]?.san ?? "", notation, "black")
                        : formatSan(m.san ?? "", notation, "black")}
                    </span>
                  </li>
                ) : null,
              )}
            </ol>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={s.stage !== "playing" || botToMove} onClick={askHint}>
            <Lightbulb /> {t("hint")}
          </Button>
          <Button
            variant="secondary"
            disabled={s.stage !== "playing" || botToMove || s.path.length === 0}
            onClick={s.takeback}
          >
            <Undo2 /> {t("takeback")}
          </Button>
          <Button variant="ghost" disabled={s.stage !== "playing"} onClick={s.resign}>
            <Flag /> {t("resign")}
          </Button>
          <BoardSettings />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("usage", { hints: s.hints, takebacks: s.takebacks })}
        </p>
      </aside>
    </div>
  );
}
