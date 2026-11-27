// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { CalendarDays, Check, Eye, Lightbulb, LineChart, Pause, Play, Share2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BoardSettings } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { type DailyResult, getDb } from "@/lib/local-db";
import { useApiErrorText } from "@/lib/use-api-error";
import { cn } from "@/lib/utils";
import { PuzzleBoard } from "./puzzle-board";
import { fetchDailyPuzzle, type Puzzle, recordAttempt } from "./puzzle-data";
import { PuzzleMoveStrip } from "./puzzle-move-strip";
import { usePuzzle } from "./use-puzzle";
import { useThemeLabel } from "./use-theme-label";

export function DailyPuzzle() {
  const t = useTranslations("puzzles.daily");
  const tp = useTranslations("puzzles");
  const apiError = useApiErrorText();
  const themeLabel = useThemeLabel();
  const asideRef = useRef<HTMLElement>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<DailyResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchDailyPuzzle()
      .then(async ({ date: d, puzzle: p }) => {
        setDate(d);
        setPuzzle(p);
        try {
          setPrevious((await getDb()?.daily.get(d)) ?? null);
        } catch {
          setPrevious(null);
        }
      })
      .catch((e: unknown) => {
        setError(
          e instanceof ApiError && e.code === "no_puzzle"
            ? t("none")
            : e instanceof ApiError
              ? apiError(e)
              : t("loadFailed"),
        );
      });
  }, [t, apiError]);

  const state = usePuzzle(puzzle, (clean) => {
    if (!puzzle || !date || previous) return;
    void recordAttempt({ puzzleId: puzzle.id, mode: "daily", solved: clean });
  });

  // Store today's result the first time it is finished.
  useEffect(() => {
    if (!puzzle || !date || previous) return;
    if (state.status !== "solved" && state.status !== "failed") return;
    const result: DailyResult = {
      date,
      puzzleId: puzzle.id,
      solved: state.status === "solved",
      mistakes: state.mistakes,
    };
    setPrevious(result);
    void getDb()
      ?.daily.put(result)
      .catch(() => undefined);
  }, [state.status, puzzle, date, previous, state.mistakes]);

  const share = async () => {
    if (!previous || !date) return;
    const text = `${t(previous.solved ? "shareSolved" : "shareMissed", { date })}\n${window.location.origin}/puzzles/daily`;
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const finished = state.status === "solved" || state.status === "failed";

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden md:grid md:flex-initial md:gap-6 md:overflow-visible lg:grid-cols-[minmax(0,1fr)_minmax(300px,22rem)]">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-19rem))] shrink-0 md:max-w-[min(100%,calc(100dvh-10rem))]">
          <PuzzleBoard state={state} />
        </div>
        <aside
          ref={asideRef}
          className="glass flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl p-3 md:flex-initial md:gap-4 md:p-5"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-gold/15 text-gold">
              <CalendarDays />
            </span>
            <div>
              <h1 className="font-display text-3xl leading-none">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">
                {date
                  ? new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
                      dateStyle: "long",
                      timeZone: "UTC",
                    })
                  : "…"}
                {` · ${t("sameForEveryone")}`}
              </p>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <p
              role="status"
              className={cn(
                "text-sm font-medium",
                state.hintSquare && (state.status === "playing" || state.status === "wrong") && "text-gold",
                !state.hintSquare && state.status === "wrong" && "text-destructive",
                !state.hintSquare && state.status === "solved" && "text-primary",
              )}
            >
              {!puzzle
                ? tp("status.loadingPuzzle")
                : state.hintSquare && (state.status === "playing" || state.status === "wrong")
                  ? tp("hintShown")
                  : state.status === "loading"
                    ? tp("status.watch")
                    : state.status === "playing"
                      ? tp(state.color === "white" ? "status.findWhite" : "status.findBlack")
                      : state.status === "wrong"
                        ? t("wrong")
                        : state.status === "solved"
                          ? t("solved")
                          : t("done")}
            </p>
          )}

          {previous && !finished && (
            <p className="rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {t(previous.solved ? "alreadyFirstTry" : "alreadyMistakes")}
            </p>
          )}

          <PuzzleMoveStrip state={state} scrollContainerRef={asideRef} />

          <div className="flex flex-wrap gap-2">
            {puzzle && !finished && state.status !== "loading" && (
              <>
                <HintTooltip label={tp("hint")} description={tp("hintTooltip")}>
                  <Button
                    variant="secondary"
                    disabled={!state.canMove || Boolean(state.hintSquare)}
                    onClick={state.requestHint}
                  >
                    <Lightbulb /> {tp("hint")}
                  </Button>
                </HintTooltip>
                <Button variant="secondary" onClick={state.showSolution}>
                  <Eye /> {tp("showSolution")}
                </Button>
              </>
            )}
            {previous && (
              <Button onClick={share}>
                {copied ? <Check /> : <Share2 />} {t("share")}
              </Button>
            )}
            {finished && (
              <>
                <Button variant="secondary" onClick={state.toggleReplay} disabled={state.liveStep === 0}>
                  {state.replaying ? <Pause /> : <Play />}
                  {state.replaying ? tp("stopReplay") : tp("replay")}
                </Button>
                <Button variant="ghost" asChild>
                  <Link href={`/analysis?fen=${encodeURIComponent(state.fen)}`}>
                    <LineChart /> {tp("analyze")}
                  </Link>
                </Button>
              </>
            )}
            <BoardSettings />
          </div>

          {finished && puzzle && (
            <div className="space-y-2 border-t pt-4 text-sm">
              <p>
                {tp("puzzleRating")} <span className="font-semibold">{puzzle.rating}</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {puzzle.themes.map((id) => (
                  <span key={id} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {themeLabel(id)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Link href="/puzzles" className="mt-auto text-sm text-primary underline-offset-2 hover:underline">
            {t("more")} →
          </Link>
        </aside>
      </div>
    </TooltipProvider>
  );
}
