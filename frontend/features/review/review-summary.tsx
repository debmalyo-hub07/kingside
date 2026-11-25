// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { MOVE_CLASSES, type MoveReview, type Phase, type PlayerSummary } from "@kingside/chess-core";
import { useTranslations } from "next-intl";
import { formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { MoveClassBadge, useClassLabel } from "./move-classes";
import { useReview } from "./review-store";

const PHASES: Phase[] = ["opening", "middlegame", "endgame"];

export function accuracyTone(acc: number | null): string {
  if (acc === null) return "text-muted-foreground";
  if (acc >= 90) return "text-primary";
  if (acc >= 75) return "text-gold";
  return "text-orange-400";
}

function moveNumber(m: MoveReview): string {
  return m.color === "white" ? `${Math.ceil(m.ply / 2)}.` : `${Math.ceil(m.ply / 2)}…`;
}

/** Best and worst phase (needs two measured phases) for the coach summary. */
function phaseExtremes(
  s: PlayerSummary,
  metric: "accuracy" | "precision",
): { best: Phase; worst: Phase } | null {
  const source = metric === "precision" ? s.phasePrecision : s.phaseAccuracy;
  const measured = PHASES.filter((p) => source[p] !== null);
  if (measured.length < 2) return null;
  const by = (p: Phase) => source[p] ?? 0;
  const sorted = [...measured].sort((a, b) => by(b) - by(a));
  const best = sorted[0] as Phase;
  const worst = sorted[sorted.length - 1] as Phase;
  return by(best) - by(worst) >= 5 ? { best, worst } : null;
}

export function ReviewSummary({ onSeek }: { onSeek: (ply: number) => void }) {
  const { review, meta, opening } = useReview();
  const notation = useSettings((s) => s.notation);
  const metric = useSettings((s) => s.reviewMetric);
  const t = useTranslations("review.report");
  const classLabel = useClassLabel();
  if (!review || !meta) return null;
  const players = [
    { color: "white" as const, info: meta.white, s: review.white },
    { color: "black" as const, info: meta.black, s: review.black },
  ];
  const shownClasses = MOVE_CLASSES.filter(
    (c) => c !== "forced" || review.white.counts.forced + review.black.counts.forced > 0,
  );
  const turning = review.moves
    .filter((m) => m.classification !== "book")
    .reduce<MoveReview | null>(
      (top, m) =>
        Math.abs(m.winBefore - m.winAfter) > (top ? Math.abs(top.winBefore - top.winAfter) : 12) ? m : top,
      null,
    );

  return (
    <div className="space-y-5 p-4">
      <div className="grid grid-cols-2 gap-3">
        {players.map(({ color, info, s }) => {
          const primary = metric === "precision" ? s.precision : s.accuracy;
          const secondary = metric === "precision" ? s.accuracy : s.precision;
          return (
            <div key={color} className="rounded-2xl border bg-secondary/40 p-3 text-center">
              <p className="flex items-center justify-center gap-1.5 truncate text-sm font-medium">
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-full border",
                    color === "white" ? "border-neutral-400 bg-white" : "border-neutral-500 bg-neutral-900",
                  )}
                />
                <span className="truncate">{info.name}</span>
              </p>
              <p className={cn("mt-1 font-display text-5xl leading-none", accuracyTone(primary))}>
                {primary === null ? "—" : primary.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(metric === "precision" ? "precision" : "accuracy")}
              </p>
              <dl className="mt-2 space-y-0.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt
                    className="text-muted-foreground"
                    title={metric === "precision" ? undefined : t("precisionNote")}
                  >
                    {t(metric === "precision" ? "classicAccuracy" : "precisionLabel")}
                  </dt>
                  <dd className={cn("font-mono font-semibold", accuracyTone(secondary))}>
                    {secondary === null ? "—" : secondary.toFixed(1)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("performance")}*</dt>
                  <dd className="font-semibold">{s.performance ? `≈ ${s.performance}` : t("tooShort")}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground" title={t("acplLong")}>
                    {t("acpl")}
                  </dt>
                  <dd className="font-mono">{s.acpl ?? "—"}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5 rounded-xl border bg-secondary/20 p-3 text-sm leading-relaxed">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("coachSummary")}
        </p>
        {players.map(({ color, info, s }) => {
          const ex = phaseExtremes(s, metric);
          const errors = s.counts.mistake + s.counts.blunder + s.counts.miss;
          return (
            <p key={color}>
              <span className="font-medium">{info.name}:</span>{" "}
              {errors === 0 ? t("summary.clean") : t("summary.errors", { n: errors })}
              {ex &&
                ` ${t("summary.phases", { best: t(`phaseWords.${ex.best}`), worst: t(`phaseWords.${ex.worst}`) })}`}
              {s.counts.brilliant + s.counts.great > 0 &&
                ` ${t("summary.highlights", { n: s.counts.brilliant + s.counts.great })}`}
            </p>
          );
        })}
        {turning && (
          <p>
            {t("summary.turning")}{" "}
            <button
              type="button"
              className="font-mono font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => onSeek(turning.ply)}
            >
              {moveNumber(turning)} {formatSan(turning.san, notation, turning.color)}
            </button>
          </p>
        )}
      </div>

      {opening && (
        <p className="rounded-xl border px-3 py-2 text-sm">
          <span className="font-mono text-xs text-muted-foreground">{opening.eco}</span> {opening.name}
        </p>
      )}

      <table className="w-full text-sm">
        <caption className="sr-only">{t("movesByType")}</caption>
        <tbody>
          {shownClasses.map((cls) => (
            <tr key={cls} className="border-b border-border/50 last:border-0">
              <td className="w-10 py-1.5 text-center font-mono font-semibold">{review.white.counts[cls]}</td>
              <td className="py-1.5">
                <span className="flex items-center justify-center gap-2">
                  <MoveClassBadge cls={cls} />
                  <span className="w-24">{classLabel(cls)}</span>
                </span>
              </td>
              <td className="w-10 py-1.5 text-center font-mono font-semibold">{review.black.counts[cls]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t(metric === "precision" ? "byPhasePrecision" : "byPhase")}</p>
        {PHASES.map((id) => {
          const w = metric === "precision" ? review.white.phasePrecision[id] : review.white.phaseAccuracy[id];
          const b = metric === "precision" ? review.black.phasePrecision[id] : review.black.phaseAccuracy[id];
          return (
            <div key={id} className="grid grid-cols-[1fr_6rem_1fr] items-center gap-2 text-xs">
              <PhaseBar value={w} align="right" />
              <span className="text-center text-muted-foreground">{t(`phases.${id}`)}</span>
              <PhaseBar value={b} align="left" />
            </div>
          );
        })}
      </div>

      {review.keyMoments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("keyMoments")}</p>
          <ul className="flex flex-wrap gap-2">
            {review.keyMoments.map((ply) => {
              const m = review.moves[ply - 1];
              if (!m) return null;
              return (
                <li key={ply}>
                  <button
                    type="button"
                    onClick={() => onSeek(ply)}
                    className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition hover:border-primary/50 hover:bg-accent"
                  >
                    <MoveClassBadge cls={m.classification} className="size-4 text-[8px]" />
                    <span className="font-mono">
                      {moveNumber(m)} {formatSan(m.san, notation, m.color)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">* {t("performanceNote")}</p>
    </div>
  );
}

function PhaseBar({ value, align }: { value: number | null; align: "left" | "right" }) {
  return (
    <div className={cn("flex items-center gap-2", align === "right" && "flex-row-reverse")}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
        {value !== null && (
          <div
            className={cn(
              "h-full rounded-full",
              value >= 90 ? "bg-primary" : value >= 75 ? "bg-gold" : "bg-orange-400",
              align === "right" && "ml-auto",
            )}
            style={{ width: `${Math.max(4, Math.min(100, value))}%` }}
          />
        )}
      </div>
      <span
        className={cn("w-9 font-mono", align === "right" ? "text-right" : "text-left", accuracyTone(value))}
      >
        {value?.toFixed(0) ?? "—"}
      </span>
    </div>
  );
}
