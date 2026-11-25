// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { MOVE_CLASSES, type MoveClass } from "@kingside/chess-core";
import { BarChart3, FileSearch } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CLASS_META, MoveClassBadge, useClassLabel } from "@/features/review/move-classes";
import { accuracyTone } from "@/features/review/review-summary";
import { type Drill, listDrills, listReviews, type SavedReview } from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

type Side = "white" | "black";
const PHASES = ["opening", "middlegame", "endgame"] as const;

interface Row {
  r: SavedReview;
  side: Side;
}

function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function score(row: Row): number | null {
  const { result } = row.r;
  if (result === "1/2-1/2") return 0.5;
  if (result === "1-0") return row.side === "white" ? 1 : 0;
  if (result === "0-1") return row.side === "black" ? 1 : 0;
  return null;
}

/** Accuracy over time: one point per game, oldest first. Hover/focus a point for its game. */
function AccuracyTrend({ rows }: { rows: Row[] }) {
  const t = useTranslations("insights");
  const pts = rows
    .map((x) => ({
      id: x.r.gameHash,
      acc: x.r.accuracy[x.side],
      label: `${x.r.white} – ${x.r.black}`,
      date: x.r.date,
    }))
    .filter((p): p is { id: string; acc: number; label: string; date: string | null } => p.acc !== null)
    .reverse();
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return <p className="text-sm text-muted-foreground">{t("needMore")}</p>;
  const W = 600;
  const H = 160;
  const pad = 24;
  const min = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.acc)) / 10) * 10);
  const max = 100;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.acc).toFixed(1)}`).join(" ");
  const h = hover !== null ? pts[hover] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full"
        role="img"
        aria-label={t("trendAria", { n: pts.length })}
      >
        {[min, (min + max) / 2, max].map((v) => (
          <g key={v}>
            <line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={2} y={y(v) + 4} className="fill-muted-foreground text-[10px]">
              {Math.round(v)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only tooltip; the svg has an aria-label summary
          <g key={p.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(i)} cy={y(p.acc)} r={10} fill="transparent" />
            <circle
              cx={x(i)}
              cy={y(p.acc)}
              r={hover === i ? 5 : 3.5}
              className="fill-primary stroke-background"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2 py-1 text-xs shadow"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.acc) / H) * 100}%` }}
        >
          <p className="font-mono font-semibold">{h.acc.toFixed(1)}</p>
          <p className="text-muted-foreground">{h.label}</p>
          {h.date && <p className="text-muted-foreground">{h.date}</p>}
        </div>
      )}
    </div>
  );
}

export function InsightsView() {
  const t = useTranslations("insights");
  const classLabel = useClassLabel();
  const myNames = useSettings((s) => s.myNames);
  const [reviews, setReviews] = useState<SavedReview[] | null>(null);
  const [drills, setDrills] = useState<Drill[]>([]);

  useEffect(() => {
    void listReviews().then(setReviews);
    void listDrills().then(setDrills);
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!reviews) return [];
    const names = myNames.map((n) => n.toLowerCase());
    return reviews.flatMap((r): Row[] => {
      const me =
        r.me ??
        (names.includes(r.white.toLowerCase())
          ? "white"
          : names.includes(r.black.toLowerCase())
            ? "black"
            : null);
      return me ? [{ r, side: me }] : [];
    });
  }, [reviews, myNames]);

  if (reviews === null) return <div className="h-96 animate-pulse rounded-3xl bg-secondary" />;

  const header = (
    <header className="text-center">
      <h1 className="font-display text-5xl tracking-tight">{t("title")}</h1>
      <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{t("subtitle")}</p>
    </header>
  );

  if (rows.length === 0) {
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

  const scores = rows.map(score).filter((s): s is number => s !== null);
  const wins = scores.filter((s) => s === 1).length;
  const draws = scores.filter((s) => s === 0.5).length;
  const losses = scores.filter((s) => s === 0).length;
  const acc = mean(rows.map((x) => x.r.accuracy[x.side]));
  const acpl = mean(rows.map((x) => x.r.acpl[x.side]));
  const bySide = (["white", "black"] as const).map((side) => {
    const own = rows.filter((x) => x.side === side);
    const sc = own.map(score).filter((s): s is number => s !== null);
    return {
      side,
      games: own.length,
      accuracy: mean(own.map((x) => x.r.accuracy[side])),
      score: sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length) * 100 : null,
    };
  });
  const phase = PHASES.map((p) => ({ p, v: mean(rows.map((x) => x.r.phaseAccuracy[x.side][p])) }));
  const counts = Object.fromEntries(MOVE_CLASSES.map((c) => [c, 0])) as Record<MoveClass, number>;
  for (const x of rows) for (const c of MOVE_CLASSES) counts[c] += x.r.counts[x.side][c] ?? 0;
  const totalMoves = MOVE_CLASSES.reduce((a, c) => a + counts[c], 0) || 1;
  const openings = new Map<string, Row[]>();
  for (const x of rows) {
    const key = x.r.opening ?? t("unknownOpening");
    openings.set(key, [...(openings.get(key) ?? []), x]);
  }
  const openingRows = [...openings.entries()]
    .map(([name, list]) => {
      const sc = list.map(score).filter((s): s is number => s !== null);
      return {
        name,
        games: list.length,
        score: sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length) * 100 : null,
        accuracy: mean(list.map((x) => x.r.accuracy[x.side])),
      };
    })
    .sort((a, b) => b.games - a.games)
    .slice(0, 10);
  const worstPhase = [...phase].filter((x) => x.v !== null).sort((a, b) => (a.v ?? 0) - (b.v ?? 0))[0];
  const errorsPerGame = (counts.mistake + counts.blunder + counts.miss) / rows.length;
  const due = drills.filter((d) => d.due <= Date.now()).length;

  const tile = (label: string, value: string, tone?: string) => (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-4xl leading-none", tone)}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-8">
      {header}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t("overview")}>
        {tile(t("games"), String(rows.length))}
        {tile(t("accuracy"), acc === null ? "—" : acc.toFixed(1), accuracyTone(acc))}
        {tile(t("acpl"), acpl === null ? "—" : String(Math.round(acpl)))}
        {tile(t("record"), `${wins}/${draws}/${losses}`)}
      </section>

      <section className="glass space-y-3 rounded-3xl p-5">
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
        <section className="glass space-y-3 rounded-3xl p-5">
          <h2 className="font-semibold">{t("trend")}</h2>
          <AccuracyTrend rows={rows} />
        </section>

        <section className="glass space-y-4 rounded-3xl p-5">
          <h2 className="font-semibold">{t("byPhase")}</h2>
          {phase.map(({ p, v }) => (
            <div key={p} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t(`phases.${p}`)}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                {v !== null && (
                  <div
                    className={cn(
                      "h-full rounded-full",
                      v >= 90 ? "bg-primary" : v >= 75 ? "bg-gold" : "bg-orange-400",
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

      <section className="glass space-y-3 rounded-3xl p-5">
        <h2 className="font-semibold">{t("quality")}</h2>
        <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
          {MOVE_CLASSES.filter((c) => counts[c] > 0).map((c) => (
            <div
              key={c}
              title={`${classLabel(c)}: ${counts[c]}`}
              style={{ width: `${(counts[c] / totalMoves) * 100}%`, backgroundColor: CLASS_META[c].color }}
            />
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {MOVE_CLASSES.filter((c) => counts[c] > 0).map((c) => (
            <li key={c} className="flex items-center gap-2">
              <MoveClassBadge cls={c} className="size-4 text-[8px]" />
              <span className="truncate">{classLabel(c)}</span>
              <span className="ml-auto font-mono text-muted-foreground">
                {((counts[c] / totalMoves) * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="glass space-y-3 rounded-3xl p-5">
        <h2 className="font-semibold">{t("openings")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="font-normal">{t("opening")}</th>
                <th className="font-normal">{t("games")}</th>
                <th className="font-normal">{t("scorePct")}</th>
                <th className="font-normal">{t("accuracy")}</th>
              </tr>
            </thead>
            <tbody>
              {openingRows.map((o) => (
                <tr key={o.name} className="border-t border-border/50">
                  <td className="max-w-[18rem] truncate py-1.5">{o.name}</td>
                  <td className="font-mono">{o.games}</td>
                  <td className="font-mono">{o.score === null ? "—" : `${o.score.toFixed(0)}%`}</td>
                  <td className={cn("font-mono", accuracyTone(o.accuracy))}>
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
  );
}
