// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { addMove, createTree, positionFromFen } from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import { ArrowLeft, ArrowRight, Eye, FileSearch, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import {
  clampEngineHash,
  clampEngineThreads,
  engineThreadsAvailable,
  prefetchEngine,
  StockfishEngine,
} from "@/engine/stockfish-engine";
import { MoveClassBadge } from "@/features/review/move-classes";
import { judgeAlternativeMove, RETRY_TOLERANCE } from "@/features/review/retry-judge";
import { answerDrill, type Drill, deleteDrills, listDrills } from "@/lib/local-db";
import { formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

const CHECK_NODES = 300_000;
const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;

type Result = { kind: "checking" | "correct" | "alsoGood" | "wrong"; tried: string } | null;

export function DrillTrainer() {
  const t = useTranslations("practice.drill");
  const tg = useTranslations("practice.fromGames");
  const notation = useSettings((s) => s.notation);
  const [queue, setQueue] = useState<Drill[] | null>(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<Result>(null);
  const [shown, setShown] = useState(false);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const boardApi = useRef<Api | null>(null);
  const engine = useRef<StockfishEngine | null>(null);
  const checkAbort = useRef<AbortController | null>(null);
  const checkSeq = useRef(0);

  const cancelCheck = useCallback(() => {
    checkAbort.current?.abort();
    checkAbort.current = null;
    checkSeq.current++;
    engine.current?.stop();
    setPromotion(null);
  }, []);

  useEffect(() => {
    const now = Date.now();
    void listDrills().then((all) => setQueue(all.filter((d) => d.due <= now)));
    return () => {
      checkAbort.current?.abort();
      engine.current?.destroy();
    };
  }, []);

  const drill = queue?.[index];
  const pos = useMemo(() => (drill ? positionFromFen(drill.fen) : null), [drill]);

  useEffect(() => {
    if (drill && result?.kind === "wrong") {
      boardApi.current?.set({ fen: drill.fen });
    }
  }, [drill, result]);

  if (queue === null)
    return <div className="mx-auto aspect-square w-full max-w-xl animate-pulse rounded-xl bg-secondary" />;

  if (!drill || !pos) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <h1 className="font-display text-4xl">{t("done")}</h1>
        <p className="text-muted-foreground">{t("comeBack")}</p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" asChild>
            <Link href="/practice">
              <ArrowLeft /> {t("title")}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/review">
              <FileSearch /> {tg("reviewGame")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const san = (s: string) => formatSan(s, notation, drill.color);

  const submitMove = async (orig: Key, dest: Key, promo = "") => {
    if (result && result.kind !== "wrong") return;
    const uci = orig + dest + promo;
    const tree = createTree(drill.fen);
    const path = addMove(tree, [], uci);
    const node = path ? tree.root.children[0] : undefined;
    if (!node?.san) {
      boardApi.current?.set({ fen: drill.fen });
      return;
    }

    const tried = san(node.san);
    const firstAttempt = !result;
    const normalizedUci = node.uci ?? uci;

    if (normalizedUci === drill.bestUci || node.san === drill.bestSan) {
      setResult({ kind: "correct", tried });
      if (firstAttempt) void answerDrill(drill.id, true);
      return;
    }
    if (normalizedUci === drill.playedUci) {
      setResult({ kind: "wrong", tried });
      if (firstAttempt) void answerDrill(drill.id, false);
      return;
    }

    checkAbort.current?.abort();
    const controller = new AbortController();
    checkAbort.current = controller;
    const seq = ++checkSeq.current;
    const drillId = drill.id;

    setResult({ kind: "checking", tried });
    try {
      const kind = await judgeAlternativeMove({
        afterFen: node.fen,
        uci: normalizedUci,
        san: node.san,
        color: drill.color,
        lines: drill.lines,
        bestSan: drill.bestSan,
        bestUci: drill.bestUci,
        playedUci: drill.playedUci,
        tolerance: RETRY_TOLERANCE,
        evaluateScore: async () => {
          if (!engine.current) {
            await prefetchEngine("full");
            if (controller.signal.aborted || seq !== checkSeq.current) return undefined;
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
            { depth: null, nodes: CHECK_NODES, multiPv: 1 },
            controller.signal,
          );
          return snap.lines[0]?.score;
        },
      });
      if (controller.signal.aborted || seq !== checkSeq.current) return;
      setResult({ kind, tried });
      if (firstAttempt) void answerDrill(drillId, kind !== "wrong");
    } catch {
      engine.current?.destroy();
      engine.current = null;
      if (controller.signal.aborted || seq !== checkSeq.current) return;
      boardApi.current?.set({ fen: drill.fen });
      setResult(null);
    }
  };

  const onMove = async (orig: Key, dest: Key) => {
    if (result && result.kind !== "wrong") return;
    const sq = parseSquare(orig);
    const moving = sq !== undefined ? pos.board.get(sq) : undefined;
    if (moving?.role === "pawn" && (dest[1] === "8" || dest[1] === "1")) {
      setPromotion({ orig, dest });
      return;
    }
    await submitMove(orig, dest);
  };

  const next = () => {
    cancelCheck();
    setResult(null);
    setShown(false);
    setIndex((i) => i + 1);
  };

  const remove = async () => {
    cancelCheck();
    await deleteDrills([drill.id]);
    setQueue((q) => (q ? q.filter((d) => d.id !== drill.id) : q));
    setResult(null);
    setShown(false);
  };

  const solved = result?.kind === "correct" || result?.kind === "alsoGood";
  const checking = result?.kind === "checking";
  const shapes: DrawShape[] =
    shown || result?.kind === "wrong"
      ? [{ orig: drill.bestUci.slice(0, 2) as Key, dest: drill.bestUci.slice(2, 4) as Key, brush: "green" }]
      : [];
  const dests =
    solved || shown || checking || promotion
      ? new Map<Key, Key[]>()
      : (chessgroundDests(pos) as Map<Key, Key[]>);
  const moveNo = `${Math.ceil(drill.ply / 2)}${drill.color === "white" ? "." : "…"}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,24rem)]">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-12rem))] space-y-2">
        <ChessBoard
          sound
          fen={drill.fen}
          orientation={drill.color}
          turnColor={pos.turn}
          check={pos.isCheck()}
          dests={dests}
          autoShapes={shapes}
          onReady={(a) => {
            boardApi.current = a;
          }}
          onMove={onMove}
          key={drill.id}
        >
          {promotion && (
            <PromotionPicker
              color={pos.turn}
              onPick={(role) => {
                const { orig, dest } = promotion;
                setPromotion(null);
                void submitMove(orig, dest, ROLE_CHAR[role]);
              }}
              onCancel={() => {
                setPromotion(null);
                boardApi.current?.set({ fen: drill.fen });
              }}
            />
          )}
        </ChessBoard>
        <div className="flex justify-center">
          <BoardSettings />
        </div>
      </div>
      <aside className="glass space-y-4 self-start rounded-2xl p-5">
        <Link
          href="/practice"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> {t("title")}
        </Link>
        <p className="text-xs text-muted-foreground">
          {index + 1} / {queue.length} ·{" "}
          {t("from", { white: drill.white, black: drill.black, n: Math.ceil(drill.ply / 2) })}
        </p>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <MoveClassBadge cls={drill.classification as never} className="size-6 text-[10px]" />
          {t("find", { played: `${moveNo} ${san(drill.playedSan)}` })}
        </h1>
        {drill.opening && <p className="text-sm text-muted-foreground">{drill.opening}</p>}
        <p className="text-xs text-muted-foreground">{t("box", { n: drill.box })}</p>
        {result && (
          <p
            role="status"
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
              solved && "bg-primary/15 text-primary",
              result.kind === "wrong" && "bg-destructive/10 text-destructive",
              result.kind === "checking" && "bg-secondary",
            )}
          >
            {result.kind === "checking" && <Loader2 className="size-4 animate-spin" />}
            {result.kind === "checking" && t("checking", { move: result.tried })}
            {result.kind === "correct" && t("correct", { move: result.tried })}
            {result.kind === "alsoGood" && t("alsoGood", { move: result.tried, best: san(drill.bestSan) })}
            {result.kind === "wrong" && t("wrong", { move: result.tried, best: san(drill.bestSan) })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!solved && !shown && result?.kind !== "wrong" && !checking && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                cancelCheck();
                setShown(true);
                // Looking at the answer before trying counts as not solved.
                if (!result) void answerDrill(drill.id, false);
              }}
            >
              <Eye /> {t("show")}
            </Button>
          )}
          <Button size="sm" onClick={next}>
            {solved || shown || result?.kind === "wrong" ? t("next") : t("skip")} <ArrowRight />
          </Button>
          <Button size="sm" variant="ghost" onClick={remove}>
            <Trash2 /> {t("remove")}
          </Button>
        </div>
      </aside>
    </div>
  );
}
