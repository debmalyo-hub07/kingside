// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  ArrowRight,
  Eye,
  Flame,
  Lightbulb,
  LineChart,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Trophy,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BoardSettings } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import type { PuzzleProfile } from "@/lib/local-db";
import { useApiErrorText } from "@/lib/use-api-error";
import { usePrefersReducedMotion } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";
import { PuzzleBoard } from "./puzzle-board";
import {
  fetchNextPuzzle,
  loadProfile,
  PUZZLE_THEMES,
  type Puzzle,
  ratePuzzle,
  recordAttempt,
  saveProfile,
} from "./puzzle-data";
import { PuzzleMoveStrip } from "./puzzle-move-strip";
import { type RestoredPuzzleProgress, usePuzzle } from "./use-puzzle";
import { useThemeLabel } from "./use-theme-label";

type Mode = "rated" | "streak" | "timed";

const PUZZLES_SESSION_KEY = "kingside:puzzles-session:v1";

interface PersistedPuzzlesSession {
  mode: Mode;
  theme: string | null;
  puzzle: Puzzle | null;
  delta: number | null;
  streak: number;
  streakFailed: boolean;
  runOver: boolean;
  seen: string[];
  progress: RestoredPuzzleProgress | null;
}

const MODES: { id: Mode; icon: typeof Trophy }[] = [
  { id: "rated", icon: Trophy },
  { id: "streak", icon: Flame },
  { id: "timed", icon: Timer },
];

const TIMED_MS = 180_000;
const TIMED_PENALTY_MS = 10_000;
const STREAK_FEEDBACK_DELAY_MS = 1400;
const ANY_THEME = "__all__";

function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PuzzleTrainer() {
  const themeId = useId();
  const t = useTranslations("puzzles");
  const apiError = useApiErrorText();
  const themeLabel = useThemeLabel();
  const reduceMotion = usePrefersReducedMotion();
  const asideRef = useRef<HTMLElement>(null);
  const errorText = (e: unknown) =>
    e instanceof ApiError && e.code === "no_puzzle"
      ? t("noPuzzles")
      : e instanceof ApiError
        ? apiError(e)
        : t("loadFailed");
  const [mode, setMode] = useState<Mode>("rated");
  const [theme, setTheme] = useState<string | null>(null);
  const [profile, setProfile] = useState<PuzzleProfile | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [streakFailed, setStreakFailed] = useState(false);
  const [runOver, setRunOver] = useState(false);
  const [timedStarted, setTimedStarted] = useState(false);
  const [timedLeftMs, setTimedLeftMs] = useState(TIMED_MS);
  const [score, setScore] = useState(0);
  const seen = useRef<string[]>([]);
  const requestSeq = useRef(0);
  const streakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timedLeftRef = useRef(TIMED_MS);
  timedLeftRef.current = timedLeftMs;
  const restoredProgressRef = useRef<RestoredPuzzleProgress | null>(null);
  const progressRef = useRef<RestoredPuzzleProgress | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const started = useRef(false);

  const persistSession = useCallback(
    (overrides?: Partial<PersistedPuzzlesSession>) => {
      if (!hydrated || typeof window === "undefined" || !window.sessionStorage) return;
      try {
        const currentMode = overrides?.mode ?? mode;
        const payload: PersistedPuzzlesSession = {
          mode: currentMode,
          theme: overrides?.theme !== undefined ? overrides.theme : theme,
          puzzle:
            overrides?.puzzle !== undefined ? overrides.puzzle : currentMode === "timed" ? null : puzzle,
          delta: overrides?.delta !== undefined ? overrides.delta : delta,
          streak: overrides?.streak !== undefined ? overrides.streak : streak,
          streakFailed: overrides?.streakFailed !== undefined ? overrides.streakFailed : streakFailed,
          runOver: overrides?.runOver !== undefined ? overrides.runOver : runOver,
          seen: seen.current,
          progress: overrides?.progress !== undefined ? overrides.progress : progressRef.current,
        };
        window.sessionStorage.setItem(PUZZLES_SESSION_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    },
    [hydrated, mode, theme, puzzle, delta, streak, streakFailed, runOver],
  );

  useEffect(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const raw = window.sessionStorage.getItem(PUZZLES_SESSION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedPuzzlesSession>;
          if (parsed && typeof parsed === "object") {
            const m: Mode = parsed.mode === "streak" || parsed.mode === "timed" ? parsed.mode : "rated";
            setMode(m);
            setTheme(typeof parsed.theme === "string" ? parsed.theme : null);
            setDelta(typeof parsed.delta === "number" ? parsed.delta : null);
            setStreak(typeof parsed.streak === "number" ? parsed.streak : 0);
            const sf = Boolean(parsed.streakFailed);
            setStreakFailed(sf);
            setRunOver(Boolean(parsed.runOver) || sf);
            if (Array.isArray(parsed.seen)) {
              seen.current = parsed.seen.filter((x): x is string => typeof x === "string").slice(-200);
            }
            if (m !== "timed" && parsed.puzzle && typeof parsed.puzzle.id === "string") {
              restoredProgressRef.current = parsed.progress ?? null;
              progressRef.current = parsed.progress ?? null;
              setPuzzle(parsed.puzzle);
              started.current = true;
            } else if (m === "timed") {
              started.current = true;
            }
          }
        }
      } catch {
        // ignore
      }
    }
    setHydrated(true);
    void loadProfile().then(setProfile);
    return () => {
      if (streakTimer.current) clearTimeout(streakTimer.current);
    };
  }, []);

  useEffect(() => {
    persistSession();
  }, [persistSession]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: errorText only formats text.
  const load = useCallback(
    async (rating: number, withTheme: boolean, themeOverride?: string | null) => {
      const seq = ++requestSeq.current;
      const chosenTheme = themeOverride !== undefined ? themeOverride : theme;
      restoredProgressRef.current = null;
      progressRef.current = null;
      setError(null);
      setPuzzle(null);
      setDelta(null);
      try {
        const { puzzle: p } = await fetchNextPuzzle(rating, withTheme ? chosenTheme : null, seen.current);
        if (seq !== requestSeq.current) return;
        seen.current = [...seen.current, p.id].slice(-200);
        setPuzzle(p);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setError(errorText(e));
      }
    },
    [theme],
  );

  const nextForMode = useCallback(
    (m: Mode, opts: { streak?: number; score?: number; theme?: string | null } = {}) => {
      if (m === "rated") return load(profile?.rating ?? 1500, true, opts.theme);
      if (m === "streak") return load(700 + (opts.streak ?? streak) * 60, false);
      return load(700 + (opts.score ?? score) * 40, true, opts.theme);
    },
    [load, profile, streak, score],
  );

  // First puzzle once the profile is known (unless restored from sessionStorage).
  useEffect(() => {
    if (!profile || started.current) return;
    started.current = true;
    void nextForMode(mode);
  }, [profile, mode, nextForMode]);

  const onResult = (clean: boolean) => {
    if (!puzzle) return;
    if (mode === "rated" && profile) {
      const next = ratePuzzle(profile, puzzle, clean);
      setDelta(Math.round(next.rating) - Math.round(profile.rating));
      setProfile(next);
      void saveProfile(next);
      void recordAttempt({ puzzleId: puzzle.id, mode, solved: clean, rating: next.rating });
      return;
    }
    void recordAttempt({ puzzleId: puzzle.id, mode, solved: clean });
    if (mode === "streak" && !clean) {
      setStreakFailed(true);
      if (profile && streak > profile.bestStreak) {
        const p = { ...profile, bestStreak: streak };
        setProfile(p);
        void saveProfile(p);
      }
      if (streakTimer.current) clearTimeout(streakTimer.current);
      streakTimer.current = setTimeout(() => {
        streakTimer.current = null;
        setRunOver(true);
      }, STREAK_FEEDBACK_DELAY_MS);
    }
    if (mode === "timed" && !clean) {
      const nextLeft = Math.max(0, timedLeftRef.current - TIMED_PENALTY_MS);
      timedLeftRef.current = nextLeft;
      setTimedLeftMs(nextLeft);
      if (nextLeft > 0) void nextForMode("timed");
    }
  };

  const handleProgressChange = useCallback(
    (prog: RestoredPuzzleProgress) => {
      progressRef.current = prog;
      persistSession({ progress: prog });
    },
    [persistSession],
  );

  const state = usePuzzle(puzzle, onResult, {
    restored: restoredProgressRef.current,
    onProgressChange: handleProgressChange,
  });

  // Streak and rush move on automatically after a clean solve.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to the solve only.
  useEffect(() => {
    if (state.status !== "solved") return;
    if (mode === "streak" && !runOver && !streakFailed) {
      const alreadyCounted =
        restoredProgressRef.current?.puzzleId === puzzle?.id &&
        restoredProgressRef.current?.status === "solved";
      const s = alreadyCounted ? streak : streak + 1;
      if (!alreadyCounted) setStreak(s);
      const t = setTimeout(() => void nextForMode("streak", { streak: s }), 700);
      return () => clearTimeout(t);
    }
    if (mode === "timed" && timedStarted && timedLeftRef.current > 0) {
      const s = score + 1;
      setScore(s);
      const t = setTimeout(() => void nextForMode("timed", { score: s }), 400);
      return () => clearTimeout(t);
    }
  }, [state.status]);

  // Rush clock: ticks only while a puzzle is loaded and active (never during setup animation or fetch).
  const timedOver = mode === "timed" && timedStarted && timedLeftMs <= 0;
  const clockRunning =
    mode === "timed" &&
    timedStarted &&
    !timedOver &&
    puzzle !== null &&
    (state.status === "playing" || state.status === "wrong");

  useEffect(() => {
    if (!clockRunning) return;
    let lastTick = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = now - lastTick;
      lastTick = now;
      setTimedLeftMs((prev) => {
        const next = Math.max(0, prev - dt);
        timedLeftRef.current = next;
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [clockRunning]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once when time runs out.
  useEffect(() => {
    if (!timedOver || !profile) return;
    requestSeq.current++;
    if (score > profile.bestTimed) {
      const p = { ...profile, bestTimed: score };
      setProfile(p);
      void saveProfile(p);
    }
  }, [timedOver]);

  const switchMode = (m: Mode) => {
    requestSeq.current++;
    if (streakTimer.current) {
      clearTimeout(streakTimer.current);
      streakTimer.current = null;
    }
    setMode(m);
    setStreak(0);
    setStreakFailed(false);
    setRunOver(false);
    setScore(0);
    setTimedStarted(false);
    timedLeftRef.current = TIMED_MS;
    setTimedLeftMs(TIMED_MS);
    restoredProgressRef.current = null;
    progressRef.current = null;
    if (m !== "timed") void nextForMode(m, { streak: 0, score: 0 });
    else setPuzzle(null);
  };

  const finished = state.status === "solved" || state.status === "failed";
  const boardLocked = (mode === "streak" && runOver) || timedOver || (mode === "timed" && !timedStarted);
  const canMoveNow = state.canMove && !boardLocked && !(mode === "streak" && streakFailed);

  const message = (() => {
    if (error) return { tone: "text-destructive", text: error };
    if (!puzzle) return { tone: "text-muted-foreground", text: t("status.loadingPuzzle") };
    if (state.hintSquare && (state.status === "playing" || state.status === "wrong")) {
      return { tone: "text-gold", text: t("hintShown") };
    }
    switch (state.status) {
      case "loading":
        return { tone: "text-muted-foreground", text: t("status.watch") };
      case "playing":
        return { tone: "", text: t(state.color === "white" ? "status.findWhite" : "status.findBlack") };
      case "wrong":
        return { tone: "text-destructive", text: t("status.wrong") };
      case "solved":
        return { tone: "text-primary", text: t("status.solved") };
      case "failed":
        return { tone: "text-gold", text: t("status.failed") };
      default:
        return { tone: "", text: "" };
    }
  })();

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden md:grid md:flex-initial md:gap-6 md:overflow-visible lg:grid-cols-[minmax(0,1fr)_minmax(320px,24rem)]">
        <div className="relative mx-auto w-full max-w-[min(100%,calc(100dvh-21rem))] shrink-0 md:max-w-[min(100%,calc(100dvh-10rem))]">
          <PuzzleBoard state={{ ...state, canMove: canMoveNow }} />
          <AnimatePresence>
            {(boardLocked || (mode === "timed" && !timedStarted)) && (
              <m.div
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0 }}
                className="absolute inset-0 z-20 grid place-items-center rounded-md bg-black/55 p-6 text-center text-white backdrop-blur-[2px]"
              >
                {mode === "timed" && !timedStarted ? (
                  <div className="space-y-4">
                    <p className="font-display text-4xl">{t("modes.timed")}</p>
                    <p className="text-sm text-white/80">{t("rushIntro")}</p>
                    <Button
                      size="lg"
                      onClick={() => {
                        setScore(0);
                        timedLeftRef.current = TIMED_MS;
                        setTimedLeftMs(TIMED_MS);
                        setTimedStarted(true);
                        void nextForMode("timed", { score: 0 });
                      }}
                    >
                      <Play /> {t("start")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="kpi-num text-5xl">{mode === "streak" ? streak : score}</p>
                    <p className="text-sm text-white/80">
                      {t(mode === "streak" ? "inARow" : "solvedCount", {
                        best:
                          mode === "streak"
                            ? Math.max(profile?.bestStreak ?? 0, streak)
                            : Math.max(profile?.bestTimed ?? 0, score),
                      })}
                    </p>
                    <Button size="lg" onClick={() => switchMode(mode)}>
                      <RotateCcw /> {t("playAgain")}
                    </Button>
                  </div>
                )}
              </m.div>
            )}
          </AnimatePresence>
        </div>

        <aside
          ref={asideRef}
          className="panel-solid flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl p-3 md:flex-initial md:gap-4 md:p-5"
        >
          <div
            role="tablist"
            aria-label={t("mode")}
            className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-secondary p-1"
          >
            {MODES.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => switchMode(id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition md:py-2",
                  mode === id ? "bg-background shadow" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(`modes.${id}`)}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t(`blurbs.${mode}`)}</p>

          {mode === "rated" && (
            <div className="flex items-end gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("yourRating")}</p>
                <p className="kpi-num mt-0.5 text-4xl sm:text-5xl">
                  {profile ? Math.round(profile.rating) : "—"}
                </p>
              </div>
              <AnimatePresence>
                {delta !== null && (
                  <m.span
                    key={`${puzzle?.id}-${delta}`}
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "mb-2 rounded-full px-2 py-0.5 font-mono text-sm font-semibold",
                      delta >= 0 ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {delta >= 0 ? `+${delta}` : delta}
                  </m.span>
                )}
              </AnimatePresence>
              {profile && profile.rd > 110 && (
                <span className="mb-2 text-xs text-muted-foreground">({t("provisional")})</span>
              )}
            </div>
          )}
          {mode === "streak" && (
            <div className="flex flex-wrap items-center gap-2 text-lg">
              <Flame className="text-warning" aria-hidden />{" "}
              <m.span
                key={streak}
                initial={reduceMotion ? false : { scale: 0.85, opacity: 0.6 }}
                animate={{ scale: 1, opacity: 1 }}
                className="font-display text-4xl"
              >
                {streak}
              </m.span>
              <span className="text-sm text-muted-foreground">
                {t("best", { n: profile?.bestStreak ?? 0 })}
              </span>
              {streak >= 3 && (
                <m.span
                  key={`milestone-${streak}`}
                  initial={reduceMotion ? false : { scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary"
                >
                  {t("streakMilestone", { n: streak })}
                </m.span>
              )}
            </div>
          )}
          {mode === "timed" && (
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "font-mono text-4xl",
                  timedLeftMs < 20_000 && timedStarted && "text-destructive",
                )}
              >
                {formatClock(timedLeftMs)}
              </span>
              <span className="text-right">
                <m.span
                  key={score}
                  initial={reduceMotion ? false : { scale: 0.85, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="inline-block font-display text-4xl"
                >
                  {score}
                </m.span>
                <span className="block text-xs text-muted-foreground">
                  {t("best", { n: profile?.bestTimed ?? 0 })}
                </span>
              </span>
            </div>
          )}

          {mode !== "streak" && (
            <div className="space-y-1 text-sm">
              <label htmlFor={themeId} className="block text-muted-foreground">
                {t("theme")}
              </label>
              <Select
                value={theme ?? ANY_THEME}
                onValueChange={(v) => {
                  const nextTheme = v === ANY_THEME ? null : v;
                  setTheme(nextTheme);
                  if (mode === "rated") {
                    void load(profile?.rating ?? 1500, true, nextTheme);
                  } else if (mode === "timed" && timedStarted && !timedOver) {
                    void load(700 + score * 40, true, nextTheme);
                  }
                }}
              >
                <SelectTrigger id={themeId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_THEME}>{t("anyTheme")}</SelectItem>
                  {PUZZLE_THEMES.map((id) => (
                    <SelectItem key={id} value={id}>
                      {themeLabel(id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p role="status" className={cn("min-h-6 text-sm font-medium", message.tone)}>
            {message.text}
          </p>

          <PuzzleMoveStrip state={state} scrollContainerRef={asideRef} />

          <div className="flex flex-wrap gap-2">
            {!finished && puzzle && state.status !== "loading" && !boardLocked && (
              <HintTooltip label={t("hint")} description={t("hintTooltip")}>
                <Button
                  variant="secondary"
                  disabled={!canMoveNow || Boolean(state.hintSquare)}
                  onClick={state.requestHint}
                >
                  <Lightbulb /> {t("hint")}
                </Button>
              </HintTooltip>
            )}
            {mode === "rated" && !finished && puzzle && state.status !== "loading" && (
              <Button variant="secondary" onClick={state.showSolution}>
                <Eye /> {t("showSolution")}
              </Button>
            )}
            {finished && puzzle && (
              <>
                <Button variant="secondary" onClick={state.toggleReplay} disabled={state.liveStep === 0}>
                  {state.replaying ? <Pause /> : <Play />}
                  {state.replaying ? t("stopReplay") : t("replay")}
                </Button>
                <Button variant="ghost" asChild>
                  <Link href={`/analysis?fen=${encodeURIComponent(state.fen)}`}>
                    <LineChart /> {t("analyze")}
                  </Link>
                </Button>
              </>
            )}
            {mode === "rated" && (finished || error) && (
              <Button onClick={() => void nextForMode("rated")}>
                {t("next")} <ArrowRight />
              </Button>
            )}
            <BoardSettings />
          </div>

          {finished && puzzle && mode === "rated" && (
            <div className="space-y-2 border-t pt-4 text-sm">
              <p>
                {t("puzzleRating")} <span className="font-semibold">{puzzle.rating}</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {puzzle.themes.map((id) => (
                  <span key={id} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {themeLabel(id)}
                  </span>
                ))}
              </div>
              {puzzle.gameUrl && (
                <a
                  href={puzzle.gameUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("fromGame")}
                </a>
              )}
            </div>
          )}
          {!puzzle && !error && (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("loading")} />
          )}
        </aside>
      </div>
    </TooltipProvider>
  );
}
