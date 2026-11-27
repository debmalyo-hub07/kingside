// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { MOVE_CLASSES } from "@kingside/chess-core";
import { BarChart3, FileSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { CLASS_META, MoveClassBadge, useClassLabel } from "@/features/review/move-classes";
import { useReview } from "@/features/review/review-store";
import { accuracyTone } from "@/features/review/review-summary";
import {
  type Drill,
  listDrills,
  listGames,
  listReviews,
  type SavedGame,
  type SavedReview,
} from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import {
  aggregateMoveCounts,
  aggregateOpenings,
  buildGameByHashMap,
  buildTrendPoints,
  type InsightRow,
  mean,
  resolveInsightRows,
  rowScore,
  type TrendPoint,
} from "./insights-helpers";

const PHASES = ["opening", "middlegame", "endgame"] as const;

/** Accuracy over time: one point per game, oldest first. Hover/focus/activate any point to open its review. */
function AccuracyTrend({
  pts,
  gameByHash,
  reviewByHash,
  onSelect,
}: {
  pts: readonly TrendPoint[];
  gameByHash: ReadonlyMap<string, SavedGame>;
  reviewByHash: ReadonlyMap<string, SavedReview>;
  onSelect: (point: TrendPoint) => void;
}) {
  const t = useTranslations("insights");
  const [active, setActive] = useState<number | null>(null);
  const gradId = useId();

  if (pts.length < 2) return <p className="text-sm text-muted-foreground">{t("needMore")}</p>;

  const W = 600;
  const H = 180;
  const pad = 24;
  const min = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.acc)) / 10) * 10);
  const max = 100;
  const range = Math.max(max - min, 1);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.acc).toFixed(1)}`).join(" ");
  const areaPath = `${path} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const activePoint = active !== null ? pts[active] : null;
  const activeXPct = active !== null ? (x(active) / W) * 100 : 0;
  const activeYPct = activePoint ? (y(activePoint.acc) / H) * 100 : 0;

  return (
    <div className="surface-well relative aspect-[10/3] w-full rounded-2xl p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="size-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[min, (min + max) / 2, max].map((v) => (
          <g key={v}>
            <line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={2} y={y(v) + 4} className="fill-muted-foreground text-[10px]">
              {Math.round(v)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2.2} strokeLinejoin="round" />
      </svg>

      <fieldset className="absolute inset-0 border-0 p-0">
        <legend className="sr-only">{t("trendAria", { n: pts.length })}</legend>
        {pts.map((p, i) => {
          const isActive = active === i;
          const xPct = (x(i) / W) * 100;
          const yPct = (y(p.acc) / H) * 100;
          const ariaLabel = p.date
            ? t("trendPointAriaDated", { acc: p.acc.toFixed(1), players: p.label, date: p.date })
            : t("trendPointAria", { acc: p.acc.toFixed(1), players: p.label });
          return (
            <button
              key={p.id}
              type="button"
              aria-label={ariaLabel}
              data-trend-hash={p.id}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((cur) => (cur === i ? null : cur))}
              onClick={() => onSelect(p)}
              style={{ left: `${xPct}%`, top: `${yPct}%` }}
              className="group absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "rounded-full border-2 border-background bg-primary transition-transform",
                  isActive ? "size-3.5 scale-110 ring-4 ring-primary/25" : "size-2.5 group-hover:scale-125",
                )}
              />
            </button>
          );
        })}
      </fieldset>

      {activePoint && active !== null && (
        <div
          aria-hidden
          data-testid="insights-trend-tooltip"
          className="pointer-events-none absolute z-20 min-w-36 rounded-xl border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg"
          style={{
            left: `${activeXPct}%`,
            top: `${activeYPct}%`,
            transform:
              activeYPct < 42
                ? `translate(-${activeXPct}%, 16px)`
                : `translate(-${activeXPct}%, calc(-100% - 14px))`,
          }}
        >
          <p className="font-mono font-semibold">{activePoint.acc.toFixed(1)}%</p>
          <p className="truncate text-muted-foreground">{activePoint.label}</p>
          {activePoint.date && <p className="text-muted-foreground">{activePoint.date}</p>}
          <p className="mt-0.5 text-[11px] font-medium text-primary">
            {gameByHash.has(activePoint.id) || reviewByHash.get(activePoint.id)?.pgn
              ? t("trendOpenHint")
              : t("trendMissingPgn")}
          </p>
        </div>
      )}
    </div>
  );
}

export function InsightsView() {
  const t = useTranslations("insights");
  const router = useRouter();
  const classLabel = useClassLabel();
  const myNames = useSettings((s) => s.myNames);
  const [reviews, setReviews] = useState<SavedReview[] | null>(null);
  const [games, setGames] = useState<SavedGame[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [trendHint, setTrendHint] = useState<string | null>(null);
  const [metric, setMetric] = useState<"accuracy" | "precision">("accuracy");
  const [timeClass, setTimeClass] = useState<"all" | "bullet" | "blitz" | "rapid" | "classical">("all");

  useEffect(() => {
    void listReviews().then(setReviews);
    void listGames().then(setGames);
    void listDrills().then(setDrills);
  }, []);

  const allRows = useMemo<InsightRow[]>(() => {
    if (!reviews) return [];
    return resolveInsightRows(reviews, myNames);
  }, [reviews, myNames]);

  const rows = useMemo<InsightRow[]>(
    () => (timeClass === "all" ? allRows : allRows.filter((x) => x.r.timeClass === timeClass)),
    [allRows, timeClass],
  );

  const gameByHash = useMemo(() => buildGameByHashMap(games), [games]);
  const reviewByHash = useMemo(() => {
    const map = new Map<string, SavedReview>();
    for (const r of reviews ?? []) map.set(r.gameHash, r);
    return map;
  }, [reviews]);
  const trendPoints = useMemo(() => buildTrendPoints(rows, metric), [rows, metric]);
  const openingRows = useMemo(() => aggregateOpenings(rows, t("unknownOpening")), [rows, t]);
  const { counts, totalMoves } = useMemo(() => aggregateMoveCounts(rows), [rows]);

  const handleSelectPoint = async (point: TrendPoint) => {
    const savedReview = reviewByHash.get(point.id);
    const game = gameByHash.get(point.id);
    const pgn = game?.pgn ?? savedReview?.pgn;
    if (!pgn) {
      setTrendHint(t("trendNoPgn", { players: point.label }));
      return;
    }
    setTrendHint(null);
    try {
      await useReview
        .getState()
        .openSavedOrStart(pgn, savedReview, savedReview?.me ? { me: savedReview.me } : undefined);
      router.push("/review");
    } catch {
      setTrendHint(t("trendOpenFailed"));
    }
  };

  if (reviews === null) return <div className="h-96 animate-pulse rounded-3xl bg-secondary" />;

  const header = (
    <header className="text-center">
      <h1 className="font-display text-5xl tracking-tight">{t("title")}</h1>
      <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{t("subtitle")}</p>
    </header>
  );

  if (allRows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <div className="glass mx-auto max-w-xl space-y-4 rounded-3xl p-8 text-center">
          <BarChart3 className="mx-auto size-10 text-primary" aria-hidden />
          <p className="text-muted-foreground">{reviews.length ? t("noSide") : t("empty")}</p>
          {reviews.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("whoAreYou")}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {[...new Set(reviews.flatMap((r) => [r.white, r.black]))].slice(0, 8).map((name) => (
                  <Button
                    key={name}
                    size="sm"
                    variant="secondary"
                    onClick={() => useSettings.getState().update({ myNames: [name, ...myNames].slice(0, 5) })}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <Button asChild>
            <Link href="/review">
              <FileSearch /> {t("reviewGames")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const scores = rows.map(rowScore).filter((s): s is number => s !== null);
  const wins = scores.filter((s) => s === 1).length;
  const draws = scores.filter((s) => s === 0.5).length;
  const losses = scores.filter((s) => s === 0).length;
  const acc = mean(
    rows.map((x) =>
      metric === "precision" ? (x.r.precision?.[x.side] ?? x.r.accuracy[x.side]) : x.r.accuracy[x.side],
    ),
  );
  const acpl = mean(rows.map((x) => x.r.acpl[x.side]));
  const bySide = (["white", "black"] as const).map((side) => {
    const own = rows.filter((x) => x.side === side);
    const sc = own.map(rowScore).filter((s): s is number => s !== null);
    return {
      side,
      games: own.length,
      accuracy: mean(own.map((x) => x.r.accuracy[side])),
      score: sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length) * 100 : null,
    };
  });
  const phase = PHASES.map((p) => ({ p, v: mean(rows.map((x) => x.r.phaseAccuracy[x.side][p])) }));
  const moveTotalSafe = totalMoves || 1;
  const worstPhase = [...phase].filter((x) => x.v !== null).sort((a, b) => (a.v ?? 0) - (b.v ?? 0))[0];
  const errorsPerGame = (counts.mistake + counts.blunder + counts.miss) / rows.length;
  const due = drills.filter((d) => d.due <= Date.now()).length;

  const tile = (label: string, value: string, tone?: string) => (
    <div className="panel-solid rounded-2xl p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("kpi-num mt-2 text-3xl leading-none sm:text-4xl", tone)}>{value}</p>
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-8">
        {header}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl border bg-secondary/50 p-1">
            {(["all", "bullet", "blitz", "rapid", "classical"] as const).map((tc) => (
              <button
                key={tc}
                type="button"
                aria-pressed={timeClass === tc}
                onClick={() => setTimeClass(tc)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                  timeClass === tc
                    ? "bg-card-solid text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`timeClasses.${tc}`)}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-xl border bg-secondary/50 p-1">
            {(["accuracy", "precision"] as const).map((mKey) => (
              <button
                key={mKey}
                type="button"
                aria-pressed={metric === mKey}
                onClick={() => setMetric(mKey)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                  metric === mKey
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(mKey === "accuracy" ? "metricAccuracy" : "metricPrecision")}
              </button>
            ))}
          </div>
        </div>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t("overview")}>
          {tile(t("games"), String(rows.length))}
          {tile(
            t(metric === "accuracy" ? "metricAccuracy" : "metricPrecision"),
            acc === null ? "—" : acc.toFixed(1),
            accuracyTone(acc),
          )}
          {tile(t("acpl"), acpl === null ? "—" : String(Math.round(acpl)))}
          {tile(t("record"), `${wins}/${draws}/${losses}`)}
        </section>

        <section className="panel-solid space-y-3 rounded-3xl p-5">
          <h2 className="font-semibold">{t("advice.title")}</h2>
          <ul className="list-inside list-disc space-y-1 text-sm leading-relaxed">
            {worstPhase?.v != null && (
              <li>{t("advice.phase", { phase: t(`phases.${worstPhase.p}`), v: worstPhase.v.toFixed(0) })}</li>
            )}
            <li>{t("advice.errors", { n: errorsPerGame.toFixed(1) })}</li>
            {drills.length > 0 && (
              <li>
                {t("advice.drills", { n: due })}{" "}
                <Link href="/practice/drills" className="text-primary underline-offset-2 hover:underline">
                  {t("advice.drillsLink")}
                </Link>
              </li>
            )}
          </ul>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="panel-solid space-y-3 rounded-3xl p-5">
            <h2 className="font-semibold">{t("trend")}</h2>
            <AccuracyTrend
              pts={trendPoints}
              gameByHash={gameByHash}
              reviewByHash={reviewByHash}
              onSelect={(pt) => void handleSelectPoint(pt)}
            />
            {trendHint && (
              <p
                role="status"
                className="rounded-xl border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground"
              >
                {trendHint}
              </p>
            )}
          </section>

          <section className="panel-solid space-y-4 rounded-3xl p-5">
            <h2 className="font-semibold">{t("byPhase")}</h2>
            {phase.map(({ p, v }) => (
              <div key={p} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{t(`phases.${p}`)}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                  {v !== null && (
                    <div
                      className={cn(
                        "h-full rounded-full",
                        v >= 90 ? "bg-primary" : v >= 75 ? "bg-gold" : "bg-warning",
                      )}
                      style={{ width: `${v}%` }}
                    />
                  )}
                </div>
                <span className={cn("text-right font-mono", accuracyTone(v))}>{v?.toFixed(0) ?? "—"}</span>
              </div>
            ))}
            <h3 className="pt-2 text-sm font-semibold">{t("bySide")}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="font-normal">{t("side")}</th>
                  <th className="font-normal">{t("games")}</th>
                  <th className="font-normal">{t("accuracy")}</th>
                  <th className="font-normal">{t("scorePct")}</th>
                </tr>
              </thead>
              <tbody>
                {bySide.map((s) => (
                  <tr key={s.side} className="border-t border-border/50">
                    <td className="py-1.5">{t(`sides.${s.side}`)}</td>
                    <td className="font-mono">{s.games}</td>
                    <td className={cn("font-mono", accuracyTone(s.accuracy))}>
                      {s.accuracy?.toFixed(1) ?? "—"}
                    </td>
                    <td className="font-mono">{s.score === null ? "—" : `${s.score.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <section className="panel-solid space-y-3 rounded-3xl p-5">
          <h2 className="font-semibold">{t("quality")}</h2>
          <fieldset className="flex h-6 w-full gap-[2px] overflow-hidden rounded-full border-0 bg-secondary p-0">
            <legend className="sr-only">{t("qualityBreakdown")}</legend>
            {MOVE_CLASSES.filter((c) => counts[c] > 0).map((c) => {
              const label = classLabel(c);
              const pct = ((counts[c] / moveTotalSafe) * 100).toFixed(0);
              const desc = t("qualitySegment", { count: counts[c], pct });
              return (
                <HintTooltip key={c} label={label} description={desc}>
                  <button
                    type="button"
                    aria-label={`${label}: ${desc}`}
                    className="h-full min-w-[3px] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{
                      width: `${(counts[c] / moveTotalSafe) * 100}%`,
                      backgroundColor: `var(--class-${c}-bg, ${CLASS_META[c].color})`,
                    }}
                  />
                </HintTooltip>
              );
            })}
          </fieldset>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {MOVE_CLASSES.filter((c) => counts[c] > 0).map((c) => (
              <li key={c} className="flex items-center gap-2">
                <MoveClassBadge cls={c} className="size-4 text-[8px]" />
                <span className="truncate">{classLabel(c)}</span>
                <span className="ml-auto font-mono text-muted-foreground">
                  {((counts[c] / moveTotalSafe) * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel-solid space-y-3 rounded-3xl p-5">
          <h2 className="font-semibold">{t("openings")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pr-2 font-normal">{t("opening")}</th>
                  <th className="px-2 font-normal whitespace-nowrap">{t("games")}</th>
                  <th className="px-2 font-normal whitespace-nowrap">{t("scorePct")}</th>
                  <th className="pl-2 font-normal whitespace-nowrap">{t("accuracy")}</th>
                </tr>
              </thead>
              <tbody>
                {openingRows.map((o) => (
                  <tr key={o.name} className="border-t border-border/50">
                    <td className="max-w-[10rem] truncate py-1.5 pr-2 sm:max-w-[18rem]">
                      {o.eco && (
                        <span className="mr-1.5 inline-block rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary sm:mr-2 sm:text-xs">
                          {o.eco}
                        </span>
                      )}
                      <span>{o.name}</span>
                    </td>
                    <td className="px-2 font-mono whitespace-nowrap">{o.games}</td>
                    <td className="px-2 font-mono whitespace-nowrap">
                      {o.score === null ? "—" : `${o.score.toFixed(0)}%`}
                    </td>
                    <td
                      className={cn(
                        "pl-2 font-mono font-semibold whitespace-nowrap",
                        accuracyTone(o.accuracy),
                      )}
                    >
                      {o.accuracy?.toFixed(1) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="text-center text-xs text-muted-foreground">{t("privacy")}</p>
      </div>
    </TooltipProvider>
  );
}
