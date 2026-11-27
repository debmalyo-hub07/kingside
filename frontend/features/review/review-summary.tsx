// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { MOVE_CLASSES, type MoveReview, type Phase, type PlayerSummary } from "@kingside/chess-core";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HintTooltip } from "@/components/ui/tooltip";
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
  return "text-warning";
}

function moveNumber(m: MoveReview): string {
  return m.color === "white" ? `${Math.ceil(m.ply / 2)}.` : `${Math.ceil(m.ply / 2)}…`;
}

/** Best and worst phase (needs two measured phases) for the match summary. */
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

export function ReviewSummary({
  onSeek,
  onStartReview,
}: {
  onSeek: (ply: number) => void;
  onStartReview?: () => void;
}) {
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

  const phaseStartPly = (phase: Phase): number | null => {
    if (review.moves.length === 0) return null;
    if (phase === "opening") return 1;
    const idx = review.phases[phase];
    if (idx === null || idx >= review.moves.length) return null;
    return Math.min(review.moves.length, idx + 1);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2.5">
        {players.map(({ color, info, s }) => {
          const primary = metric === "precision" ? s.precision : s.accuracy;
          const secondary = metric === "precision" ? s.accuracy : s.precision;
          return (
            <div key={color} className="surface-well rounded-2xl p-3 text-center xl:px-2.5">
              <p className="flex items-center justify-center gap-1.5 truncate text-sm font-medium">
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-full border border-border",
                    color === "white" ? "bg-[var(--eval-white-bg)]" : "bg-[var(--eval-black-bg)]",
                  )}
                />
                <span className="truncate">{info.name}</span>
              </p>
              <p className={cn("kpi-num mt-1.5 text-4xl leading-none", accuracyTone(primary))}>
                {primary === null ? "—" : primary.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(metric === "precision" ? "precision" : "accuracy")}
              </p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <dt
                    className="text-left text-muted-foreground"
                    title={metric === "precision" ? undefined : t("precisionNote")}
                  >
                    {t(metric === "precision" ? "classicAccuracy" : "precisionLabel")}
                  </dt>
                  <dd
                    className={cn(
                      "shrink-0 whitespace-nowrap text-right font-mono font-semibold",
                      accuracyTone(secondary),
                    )}
                  >
                    {secondary === null ? "—" : secondary.toFixed(1)}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <dt className="whitespace-nowrap text-left text-muted-foreground">{t("performance")}*</dt>
                  <dd
                    className={cn(
                      "ml-auto text-right",
                      s.performance ? "whitespace-nowrap font-semibold" : "font-medium",
                    )}
                  >
                    {s.performance ? `≈ ${s.performance}` : t("tooShort")}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-left text-muted-foreground" title={t("acplLong")}>
                    {t("acpl")}
                  </dt>
                  <dd className="shrink-0 whitespace-nowrap text-right font-mono">{s.acpl ?? "—"}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {onStartReview && (
        <Button size="lg" className="w-full gap-2 font-semibold shadow-md" onClick={onStartReview}>
          {t("startReview")}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}

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
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-primary transition hover:bg-primary/20"
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
          {shownClasses.map((cls) => {
            const label = classLabel(cls);
            const firstWhite = review.moves.find((m) => m.color === "white" && m.classification === cls);
            const firstBlack = review.moves.find((m) => m.color === "black" && m.classification === cls);
            const firstAny =
              firstWhite && firstBlack
                ? firstWhite.ply <= firstBlack.ply
                  ? firstWhite
                  : firstBlack
                : (firstWhite ?? firstBlack);
            const wCount = review.white.counts[cls];
            const bCount = review.black.counts[cls];
            return (
              <tr key={cls} className="border-b border-border/50 last:border-0">
                <td className="w-10 py-1 text-center font-mono font-semibold">
                  {wCount > 0 && firstWhite ? (
                    <button
                      type="button"
                      onClick={() => onSeek(firstWhite.ply)}
                      aria-label={t("jumpToClass", { n: wCount, side: t("whiteSide"), cls: label })}
                      title={t("jumpToClass", { n: wCount, side: t("whiteSide"), cls: label })}
                      className="inline-flex min-w-7 items-center justify-center rounded-md px-1.5 py-0.5 transition hover:bg-accent hover:text-primary"
                    >
                      {wCount}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{wCount}</span>
                  )}
                </td>
                <td className="py-1">
                  <HintTooltip label={label} description={t(`classHints.${cls}`)}>
                    {firstAny ? (
                      <button
                        type="button"
                        onClick={() => onSeek(firstAny.ply)}
                        aria-label={t("jumpToClassAny", { cls: label })}
                        className="mx-auto flex items-center justify-center gap-2 rounded-md px-2 py-0.5 transition hover:bg-accent"
                      >
                        <MoveClassBadge cls={cls} />
                        <span className="w-24 text-left">{label}</span>
                      </button>
                    ) : (
                      <span className="mx-auto flex w-fit cursor-help items-center justify-center gap-2 rounded-md px-2 py-0.5">
                        <MoveClassBadge cls={cls} />
                        <span className="w-24 text-left">{label}</span>
                      </span>
                    )}
                  </HintTooltip>
                </td>
                <td className="w-10 py-1 text-center font-mono font-semibold">
                  {bCount > 0 && firstBlack ? (
                    <button
                      type="button"
                      onClick={() => onSeek(firstBlack.ply)}
                      aria-label={t("jumpToClass", { n: bCount, side: t("blackSide"), cls: label })}
                      title={t("jumpToClass", { n: bCount, side: t("blackSide"), cls: label })}
                      className="inline-flex min-w-7 items-center justify-center rounded-md px-1.5 py-0.5 transition hover:bg-accent hover:text-primary"
                    >
                      {bCount}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{bCount}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t(metric === "precision" ? "byPhasePrecision" : "byPhase")}</p>
        {PHASES.map((id) => {
          const w = metric === "precision" ? review.white.phasePrecision[id] : review.white.phaseAccuracy[id];
          const b = metric === "precision" ? review.black.phasePrecision[id] : review.black.phaseAccuracy[id];
          const phasePly = phaseStartPly(id);
          const clickable = phasePly !== null && (w !== null || b !== null || id === "opening");
          const row = (
            <div className="grid grid-cols-[1fr_6rem_1fr] items-center gap-2 text-xs">
              <PhaseBar value={w} align="right" />
              <span className="text-center text-muted-foreground">{t(`phases.${id}`)}</span>
              <PhaseBar value={b} align="left" />
            </div>
          );
          if (!clickable) return <div key={id}>{row}</div>;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSeek(phasePly)}
              title={t("jumpToPhase", { phase: t(`phases.${id}`) })}
              className="block w-full rounded-lg px-1 py-1 text-left transition hover:bg-accent/70"
            >
              {row}
            </button>
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
              value >= 90 ? "bg-primary" : value >= 75 ? "bg-gold" : "bg-warning",
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
