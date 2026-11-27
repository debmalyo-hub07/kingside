// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { winPercentFromScore } from "@kingside/chess-core";
import type { Key } from "chessground/types";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { EvalBar, formatScore } from "@/components/eval-bar";
import { useInView, usePrefersReducedMotion } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";
import { type HeroPly, IMMORTAL, type LegendaryGame } from "./hero-game-data";
import { LEGENDARY_IDS, loadLegendary, MOMENTS, useHeroGame } from "./legendary";

const STEP_MS = 1500;
const END_PAUSE_MS = 5000;

function moveLabel(plies: HeroPly[], ply: number): string {
  const san = plies[ply]?.san ?? "";
  const n = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${n}. ${san}` : `${n}… ${san}`;
}

/** Eval sparkline across the whole game (White win %), with interactive hover/scrub readout. */
function EvalGraph({ plies, ply, onSeek }: { plies: HeroPly[]; ply: number; onSeek: (ply: number) => void }) {
  const t = useTranslations("home.heroBoard");
  const rangeRef = useRef<HTMLInputElement>(null);
  const [hoverPly, setHoverPly] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const LAST = Math.max(plies.length - 1, 1);
  const points = useMemo(
    () =>
      plies.map((p, i) => {
        // mate 0 = the side to move is checkmated, so the side that just moved (odd ply = White) won.
        const white = p.score.mate === 0 ? (i % 2 === 1 ? 100 : 0) : winPercentFromScore(p.score);
        // Rounded so server and client render identical SVG attributes.
        return [Math.round((i / LAST) * 10000) / 100, Math.round((100 - white) * 100) / 100] as const;
      }),
    [plies, LAST],
  );
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,100 ${line} 100,100`;
  const [px, py] = points[ply] ?? [0, 50];

  const tipPly = hoverPly ?? (scrubbing ? ply : null);
  const tipPoint = tipPly !== null ? (points[tipPly] ?? [0, 50]) : null;
  const tipEntry = tipPly !== null ? plies[tipPly] : undefined;

  const plyFromClientX = (clientX: number): number => {
    const el = rangeRef.current;
    if (!el || plies.length <= 1) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
    return Math.round(ratio * (plies.length - 1));
  };

  return (
    <div className="relative select-none">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-14 w-full" aria-hidden>
        <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeOpacity="0.15" strokeWidth="0.5" />
        <polygon points={area} className="fill-foreground/10" />
        <polyline
          points={line}
          fill="none"
          className="stroke-primary"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
        {tipPoint && tipPly !== ply && (
          <line
            x1={tipPoint[0]}
            y1="0"
            x2={tipPoint[0]}
            y2="100"
            className="stroke-muted-foreground/50"
            strokeWidth="0.8"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <line
          x1={px}
          y1="0"
          x2={px}
          y2="100"
          className="stroke-gold"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={px} cy={py} r="1.6" className="fill-gold" />
        {tipPoint && tipPly !== ply && (
          <circle cx={tipPoint[0]} cy={tipPoint[1]} r="1.4" className="fill-primary" />
        )}
      </svg>

      {tipPly !== null && tipPoint && tipEntry && (
        <div
          aria-hidden
          data-testid="hero-sparkline-tooltip"
          className="pointer-events-none absolute -top-9 z-20 flex items-center gap-1.5 whitespace-nowrap rounded-lg border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md"
          style={{ left: `${tipPoint[0]}%`, transform: `translateX(-${tipPoint[0]}%)` }}
        >
          <span className="font-mono font-semibold">
            {tipPly === 0 ? t("start") : moveLabel(plies, tipPly)}
          </span>
          <span className="rounded bg-secondary px-1.5 py-px font-mono text-[10px] font-semibold text-primary">
            {formatScore(tipEntry.score)}
          </span>
        </div>
      )}

      <input
        ref={rangeRef}
        type="range"
        min={0}
        max={plies.length - 1}
        value={ply}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === "mouse") return;
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic pointer events in automated environments may lack an active pointerId.
          }
          const next = plyFromClientX(e.clientX);
          setScrubbing(true);
          setHoverPly(next);
          onSeek(next);
        }}
        onPointerMove={(e) => {
          const next = plyFromClientX(e.clientX);
          if (scrubbing) {
            if (e.pointerType === "mouse" && e.buttons === 0) {
              setScrubbing(false);
              setHoverPly(next);
              return;
            }
            setHoverPly(next);
            onSeek(next);
            return;
          }
          if (e.pointerType === "mouse") {
            setHoverPly(next);
          }
        }}
        onPointerLeave={() => {
          if (!scrubbing) setHoverPly(null);
        }}
        onPointerUp={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            // Ignore when synthetic pointer events were not captured.
          }
          setScrubbing(false);
          if (e.pointerType !== "mouse") setHoverPly(null);
        }}
        onPointerCancel={() => {
          setScrubbing(false);
          setHoverPly(null);
        }}
        onFocus={() => setHoverPly(ply)}
        onBlur={() => {
          if (!scrubbing) setHoverPly(null);
        }}
        onChange={(e) => {
          const next = Number(e.target.value);
          setHoverPly(next);
          onSeek(next);
        }}
        aria-label={t("seek")}
        className="absolute inset-0 z-10 size-full cursor-pointer touch-none opacity-0"
      />
    </div>
  );
}

export function HeroBoard() {
  const t = useTranslations("home.heroBoard");
  const tg = useTranslations("home.legendary.games");
  const { id, set: setId } = useHeroGame();
  const [game, setGame] = useState<LegendaryGame>(IMMORTAL);
  const plies = game.plies;
  const LAST = plies.length - 1;
  const reduce = usePrefersReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const inView = useInView(container, { amount: 0.3 });
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Advances once visible on screen while respecting reduced motion.
  const autoplay = playing && inView && !reduce;

  // Switching games (arrows here, or "Watch" in the legendary games section) loads the game and restarts.
  useEffect(() => {
    let live = true;
    if (id === "immortal") setGame(IMMORTAL);
    else
      void loadLegendary().then((all) => {
        const next = all.find((g) => g.id === id);
        if (live && next) setGame(next);
      });
    return () => {
      live = false;
    };
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart whenever the game changes
  useEffect(() => setPly(0), [game]);
  const step = (dir: 1 | -1) => {
    const i = LEGENDARY_IDS.indexOf(id);
    setId(LEGENDARY_IDS[(i + dir + LEGENDARY_IDS.length) % LEGENDARY_IDS.length] ?? "immortal");
    setPlaying(true);
  };

  useEffect(() => {
    if (!autoplay) return;
    const t = setTimeout(() => setPly((p) => (p >= LAST ? 0 : p + 1)), ply >= LAST ? END_PAUSE_MS : STEP_MS);
    return () => clearTimeout(t);
  }, [autoplay, ply, LAST]);

  const current = plies[ply] ?? plies[0];
  const lastMove = current?.uci ? ([current.uci.slice(0, 2), current.uci.slice(2, 4)] as Key[]) : undefined;
  const gameId = game.id as (typeof LEGENDARY_IDS)[number];
  const gameMoments = MOMENTS[gameId] ?? {};
  const momentPills = useMemo(
    () =>
      Object.entries(gameMoments)
        .map(([k, g]) => ({ ply: Number(k), glyph: g }))
        .filter((x) => Number.isFinite(x.ply) && Boolean(plies[x.ply])),
    [gameMoments, plies],
  );
  const glyph = gameMoments[ply];
  const moment = glyph ? { glyph } : undefined;
  const inCheck = current?.san?.endsWith("+") || current?.san?.endsWith("#");

  return (
    <div ref={container} className="glass relative rounded-3xl p-3 shadow-2xl shadow-black/20 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2 px-1 text-xs">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {game.white} <span className="text-muted-foreground">{t("vs")}</span> {game.black}
          </p>
          <p className="truncate text-muted-foreground">
            {tg(`${gameId}.title`)} · {game.event}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t("previousGame")}
            className="grid size-8 place-items-center rounded-lg border bg-secondary transition hover:text-primary"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t("nextGame")}
            className="grid size-8 place-items-center rounded-lg border bg-secondary transition hover:text-primary"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? t("pause") : t("play")}
            className="grid size-8 place-items-center rounded-lg border bg-secondary transition hover:text-primary"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => setPly(0)}
            aria-label={t("restart")}
            className="grid size-8 place-items-center rounded-lg border bg-secondary transition hover:text-primary"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <EvalBar
          score={current?.score.mate === 0 ? undefined : current?.score}
          whiteWin={current?.score.mate === 0 ? 100 : undefined}
          orientation="white"
          className="w-6 shrink-0 sm:w-7"
        />
        <div className="min-w-0 flex-1">
          <ChessBoard
            fen={current?.fen ?? ""}
            orientation="white"
            lastMove={lastMove}
            check={inCheck}
            turnColor={ply % 2 === 0 ? "white" : "black"}
            label={tg(`${gameId}.title`)}
          />
        </div>
      </div>

      <div className="mt-3 flex min-h-9 min-w-0 items-center justify-between gap-3 px-1">
        <span className="shrink-0 font-mono text-sm">{ply === 0 ? t("start") : moveLabel(plies, ply)}</span>
        {moment ? (
          <span
            key={ply}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-medium animate-in fade-in zoom-in-95 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none",
              moment.glyph === "!!" ? "bg-gold/15 text-gold" : "bg-primary/15 text-primary",
            )}
          >
            <span className="font-mono font-bold">{moment.glyph}</span>
            <span className="hidden truncate sm:inline">{tg(`${gameId}.moments.${ply}` as never)}</span>
          </span>
        ) : (
          <span key="eval" className="font-mono text-xs text-muted-foreground">
            {current && current.score.mate !== 0 ? `Stockfish ${formatScore(current.score)}` : ""}
          </span>
        )}
      </div>
      <EvalGraph
        plies={plies}
        ply={ply}
        onSeek={(p) => {
          setPlaying(false);
          setPly(p);
        }}
      />
      {momentPills.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-0.5">
          {momentPills.map((m) => {
            const active = ply === m.ply;
            return (
              <button
                key={m.ply}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setPly(m.ply);
                }}
                aria-pressed={active}
                className={cn(
                  "inline-flex min-h-6 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition",
                  active
                    ? "border-primary bg-primary/15 font-semibold text-primary"
                    : "border-border/80 bg-surface-well text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <span>{moveLabel(plies, m.ply)}</span>
                <span className={m.glyph === "!!" ? "font-bold text-gold" : "font-bold text-primary"}>
                  {m.glyph}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
