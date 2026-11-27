// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  addMove,
  createTree,
  gameStatus,
  type PracticeGoal,
  type PracticeStatus,
  positionFromFen,
  practiceStatus,
  type Score,
} from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Loader2,
  RotateCcw,
  Undo2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { EvalBar } from "@/components/eval-bar";
import { Button } from "@/components/ui/button";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import {
  clampEngineHash,
  clampEngineThreads,
  engineThreadsAvailable,
  prefetchEngine,
  StockfishEngine,
} from "@/engine/stockfish-engine";
import { markPractice } from "@/lib/local-db";
import { formatSan } from "@/lib/notation";
import { scrollChildIntoContainer } from "@/lib/scroll-container";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { whenIdle } from "@/lib/when-idle";
import { ALL_PRACTICE, type PracticePosition } from "./positions";

/** Engine budget for replies and judging: strong, but answers within a second on a laptop. */
const REPLY_NODES = 400_000;
const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;

export function goalText(goal: PracticeGoal, t: ReturnType<typeof useTranslations<"practice">>): string {
  switch (goal.kind) {
    case "mate":
      return goal.moves ? t("goal.mateIn", { n: goal.moves }) : t("goal.mate");
    case "promote":
      return t("goal.promote");
    case "draw":
      return t("goal.draw", { n: goal.moves });
    case "advantage":
      return t("goal.advantage", { n: goal.moves });
  }
}

interface Line {
  fens: string[];
  moves: string[];
  sans: string[];
}

function start(fen: string): Line {
  return { fens: [fen], moves: [], sans: [] };
}

function push(line: Line, uci: string): Line | null {
  const tree = createTree(line.fens.at(-1) ?? "");
  const path = addMove(tree, [], uci);
  const node = path ? tree.root.children[0] : undefined;
  if (!node) return null;
  return {
    fens: [...line.fens, node.fen],
    moves: [...line.moves, uci],
    sans: [...line.sans, node.san ?? uci],
  };
}

export function PracticeSession({ position }: { position: PracticePosition }) {
  const t = useTranslations("practice");
  const tp = useTranslations("practice.positions");
  const notation = useSettings((s) => s.notation);
  const { engineThreads, engineHashMb, analysisNet } = useSettings();
  const player = positionFromFen(position.fen).turn;
  const [line, setLine] = useState<Line>(() => start(position.fen));
  const [viewStep, setViewStep] = useState<number | null>(null);
  const [status, setStatus] = useState<PracticeStatus>("ongoing");
  const [score, setScore] = useState<Score | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const engine = useRef<StockfishEngine | null>(null);
  const boardApi = useRef<Api | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    return whenIdle(() => {
      void prefetchEngine(analysisNet);
    });
  }, [analysisNet]);

  const getEngine = useCallback(() => {
    if (engine.current && engine.current.net !== analysisNet) {
      engine.current.destroy();
      engine.current = null;
    }
    if (!engine.current) {
      const available = engineThreadsAvailable();
      const threads = clampEngineThreads(engineThreads > 0 ? Math.min(engineThreads, available) : available);
      const hashMb = clampEngineHash(engineHashMb);
      engine.current = new StockfishEngine({
        threads,
        hashMb,
        net: analysisNet,
      });
    }
    return engine.current;
  }, [engineThreads, engineHashMb, analysisNet]);

  useEffect(() => () => engine.current?.destroy(), []);

  const liveStep = line.moves.length;
  const effectiveStep = viewStep === null ? liveStep : Math.max(0, Math.min(viewStep, liveStep));
  const viewingHistory = effectiveStep < liveStep;

  useEffect(() => {
    const el = asideRef.current?.querySelector<HTMLElement>(`[data-step="${effectiveStep}"]`);
    scrollChildIntoContainer(asideRef.current, el);
  }, [effectiveStep]);

  const reset = () => {
    generation.current++;
    engine.current?.stop();
    engine.current?.newGame();
    setLine(start(position.fen));
    setViewStep(null);
    setStatus("ongoing");
    setScore(null);
    setThinking(false);
    setHint(null);
  };

  const finish = (s: PracticeStatus) => {
    setStatus(s);
    if (s !== "ongoing") void markPractice(position.id, s === "success");
  };

  const playerMove = async (uci: string) => {
    if (status !== "ongoing" || thinking || viewingHistory) return;
    const prevLine = line;
    const after = push(line, uci);
    if (!after) return;
    setHint(null);
    setViewStep(null);
    setLine(after);
    const gen = ++generation.current;
    const fen = after.fens.at(-1) ?? "";
    if (gameStatus(after.fens)) {
      finish(practiceStatus(position.goal, { ...after, player, score: null }));
      return;
    }
    setThinking(true);
    try {
      await prefetchEngine(analysisNet);
      if (gen !== generation.current) return;
      const snap = await getEngine().evaluate(fen, { depth: null, nodes: REPLY_NODES, multiPv: 1 });
      if (gen !== generation.current) return;
      const s = snap.lines[0]?.score ?? null;
      setScore(s);
      const verdict = practiceStatus(position.goal, { ...after, player, score: s });
      const reply = snap.lines[0]?.pv[0];
      if (verdict !== "ongoing" || !reply) {
        setThinking(false);
        finish(verdict);
        return;
      }
      const replied = push(after, reply);
      setThinking(false);
      if (!replied) return;
      setLine(replied);
      finish(practiceStatus(position.goal, { ...replied, player, score: s }));
    } catch {
      engine.current?.destroy();
      engine.current = null;
      if (gen === generation.current) {
        setLine(prevLine);
        setThinking(false);
      }
    }
  };

  const askHint = async () => {
    if (thinking || status !== "ongoing") return;
    setViewStep(null);
    setThinking(true);
    const gen = generation.current;
    try {
      await prefetchEngine(analysisNet);
      if (gen !== generation.current) return;
      const snap = await getEngine().evaluate(line.fens.at(-1) ?? "", {
        depth: null,
        nodes: REPLY_NODES,
        multiPv: 1,
      });
      if (gen !== generation.current) return;
      setThinking(false);
      setHint(snap.lines[0]?.pv[0] ?? null);
    } catch {
      engine.current?.destroy();
      engine.current = null;
      if (gen === generation.current) setThinking(false);
    }
  };

  const undo = () => {
    if (thinking || line.moves.length === 0) return;
    generation.current++;
    const back = line.moves.length >= 2 && positionFromFen(line.fens.at(-1) ?? "").turn === player ? 2 : 1;
    setLine({
      fens: line.fens.slice(0, -back),
      moves: line.moves.slice(0, -back),
      sans: line.sans.slice(0, -back),
    });
    setViewStep(null);
    setStatus("ongoing");
    setHint(null);
  };

  const fen = line.fens[effectiveStep] ?? position.fen;
  const pos = useMemo(() => positionFromFen(fen), [fen]);
  const canMove = !viewingHistory && status === "ongoing" && !thinking && pos.turn === player && !promotion;
  const dests = canMove ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map<Key, Key[]>();
  const last = effectiveStep > 0 ? line.moves[effectiveStep - 1] : undefined;
  const shapes: DrawShape[] =
    !viewingHistory && hint ? [{ orig: hint.slice(0, 2) as Key, brush: "yellow" }] : [];

  const index = ALL_PRACTICE.findIndex((p) => p.id === position.id);
  const next = ALL_PRACTICE[index + 1];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden md:grid md:flex-initial md:gap-4 md:overflow-visible lg:grid-cols-[minmax(0,1fr)_minmax(300px,24rem)]">
        <div className="min-w-0 shrink-0 space-y-1.5 md:space-y-2">
          <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-20.5rem))] gap-1.5 md:max-w-[min(100%,calc(100dvh-12rem))] md:gap-2">
            <EvalBar score={score ?? undefined} orientation={player} className="w-6 shrink-0 sm:w-7" />
            <div className="relative min-w-0 flex-1">
              <ChessBoard
                sound
                fen={fen}
                orientation={player}
                turnColor={pos.turn}
                lastMove={last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : undefined}
                check={pos.isCheck()}
                dests={dests}
                autoShapes={shapes}
                label={tp(`${position.id}.title`)}
                onReady={(a) => {
                  boardApi.current = a;
                }}
                onMove={(orig, dest) => {
                  const piece = pos.board.get((orig.charCodeAt(1) - 49) * 8 + (orig.charCodeAt(0) - 97));
                  if (piece?.role === "pawn" && (dest[1] === "8" || dest[1] === "1")) {
                    setPromotion({ orig, dest });
                    return;
                  }
                  void playerMove(orig + dest);
                }}
              >
                {promotion && (
                  <PromotionPicker
                    color={pos.turn}
                    onPick={(role) => {
                      void playerMove(promotion.orig + promotion.dest + ROLE_CHAR[role]);
                      setPromotion(null);
                    }}
                    onCancel={() => {
                      setPromotion(null);
                      boardApi.current?.set({ fen });
                    }}
                  />
                )}
              </ChessBoard>
              {viewingHistory && (
                <span className="pointer-events-none absolute top-2 left-2 z-10 rounded-md border bg-popover/95 px-2 py-0.5 text-xs font-medium text-popover-foreground shadow">
                  {t("session.previewBadge")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center gap-1">
            <HintTooltip label={t("session.undo")} description={t("session.undoTooltip")}>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-10 md:min-h-8"
                onClick={undo}
                disabled={thinking || line.moves.length === 0}
              >
                <Undo2 /> {t("session.undo")}
              </Button>
            </HintTooltip>
            <HintTooltip label={t("session.retry")} description={t("session.retryTooltip")}>
              <Button variant="ghost" size="sm" className="min-h-10 md:min-h-8" onClick={reset}>
                <RotateCcw /> {t("session.retry")}
              </Button>
            </HintTooltip>
            <BoardSettings />
          </div>
        </div>

        <aside
          ref={asideRef}
          className="glass flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl md:max-h-[calc(100dvh-8rem)] md:flex-initial md:self-start"
        >
          <div className="space-y-2 border-b p-3 md:space-y-3 md:p-5">
            <Link
              href="/practice"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> {t("session.back")}
            </Link>
            <h1 className="font-display text-3xl leading-tight">{tp(`${position.id}.title`)}</h1>
            <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
              {goalText(position.goal, t)}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{tp(`${position.id}.text`)}</p>
            <p className="text-xs text-muted-foreground">
              {t("session.youPlay", { color: t(`session.${player}`) })} · {t(`level.${position.level}`)}
            </p>
          </div>

          <div className="space-y-2.5 p-3 md:space-y-3 md:p-5" aria-live="polite">
            {status === "ongoing" && (
              <p className="flex items-center gap-2 text-sm">
                {thinking ? (
                  <>
                    <Loader2 className="size-4 animate-spin text-primary" /> {t("session.thinking")}
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        "size-2.5 rounded-full ring-1 ring-foreground/25",
                        player === "white" ? "bg-[var(--eval-white-bg)]" : "bg-[var(--eval-black-bg)]",
                      )}
                    />
                    {hint ? t("session.hintShown") : t("session.yourTurn")}
                  </>
                )}
              </p>
            )}
            {status === "success" && (
              <p className="flex items-center gap-2 rounded-xl bg-primary/15 px-3 py-2 text-sm font-medium text-primary">
                <CheckCircle2 className="size-4" /> {t("session.success")}
              </p>
            )}
            {status === "failure" && (
              <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <XCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">{t("session.failure")}</span>{" "}
                  {t(`session.failureReason.${position.goal.kind}`)}
                </span>
              </p>
            )}

            {line.sans.length > 0 && (
              <div className="space-y-1.5 rounded-xl bg-secondary/40 p-2">
                <div className="flex items-center justify-between gap-1">
                  <div role="toolbar" aria-label={t("session.moves")} className="flex items-center gap-0.5">
                    <HintTooltip label={t("session.first")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("session.first")}
                        disabled={effectiveStep <= 0}
                        onClick={() => setViewStep(0)}
                      >
                        <ChevronFirst className="size-3.5" />
                      </Button>
                    </HintTooltip>
                    <HintTooltip label={t("session.previous")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("session.previous")}
                        disabled={effectiveStep <= 0}
                        onClick={() => setViewStep(Math.max(0, effectiveStep - 1))}
                      >
                        <ChevronLeft className="size-3.5" />
                      </Button>
                    </HintTooltip>
                    <HintTooltip label={t("session.nextMove")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("session.nextMove")}
                        disabled={!viewingHistory}
                        onClick={() => setViewStep(effectiveStep + 1 >= liveStep ? null : effectiveStep + 1)}
                      >
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </HintTooltip>
                    <HintTooltip label={t("session.last")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("session.last")}
                        disabled={!viewingHistory}
                        onClick={() => setViewStep(null)}
                      >
                        <ChevronLast className="size-3.5" />
                      </Button>
                    </HintTooltip>
                  </div>
                </div>
                <ol aria-label={t("session.moves")} className="flex flex-wrap gap-1 font-mono text-xs">
                  {line.sans.map((san, i) => {
                    const before = positionFromFen(line.fens[i] ?? "");
                    const color = before.turn;
                    const n = before.fullmoves;
                    const stepIndex = i + 1;
                    const active = effectiveStep === stepIndex;
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: the move list only grows/shrinks at the end
                      <li key={i}>
                        <button
                          type="button"
                          data-step={stepIndex}
                          aria-current={active ? "true" : undefined}
                          onClick={() => setViewStep(stepIndex >= liveStep ? null : stepIndex)}
                          className={cn(
                            "rounded-md px-1.5 py-0.5 transition hover:bg-accent",
                            active && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                          )}
                        >
                          {(color === "white" || i === 0) && (
                            <span className="mr-0.5 opacity-75">{color === "white" ? `${n}.` : `${n}…`}</span>
                          )}
                          {formatSan(san, notation, color)}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {status === "ongoing" && (
                <HintTooltip label={t("session.hint")} description={t("session.hintTooltip")}>
                  <Button size="sm" variant="secondary" onClick={askHint} disabled={thinking || !!hint}>
                    <Lightbulb /> {t("session.hint")}
                  </Button>
                </HintTooltip>
              )}
              {status !== "ongoing" && (
                <Button size="sm" variant={status === "success" ? "secondary" : "default"} onClick={reset}>
                  <RotateCcw /> {t("session.retry")}
                </Button>
              )}
              {next && status === "success" && (
                <Button size="sm" asChild>
                  <Link href={`/practice/${next.id}`}>
                    {t("session.next")} <ArrowRight />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </TooltipProvider>
  );
}
