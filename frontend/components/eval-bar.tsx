// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Score, winPercentFromScore } from "@kingside/chess-core";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function formatScore(score: Score): string {
  if (score.mate !== undefined)
    return score.mate === 0 ? "#" : `${score.mate > 0 ? "" : "-"}M${Math.abs(score.mate)}`;
  const pawns = score.cp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(Math.abs(pawns) >= 10 ? 0 : 1)}`;
}

/** Vertical White-POV eval bar. `whiteWin` overrides the score (game over positions). */
export function EvalBar({
  score,
  whiteWin,
  orientation,
  badge,
  badgeTitle,
  className,
}: {
  score: Score | undefined;
  whiteWin?: number;
  orientation: "white" | "black";
  /** Small tag at the middle of the bar, e.g. "TB" when a tablebase result is known. */
  badge?: string | undefined;
  badgeTitle?: string | undefined;
  className?: string;
}) {
  const t = useTranslations("board");
  const white = whiteWin ?? (score ? winPercentFromScore(score) : 50);
  const label = score ? formatScore(score) : whiteWin !== undefined ? (white === 50 ? "½" : "#") : "";
  const whiteAhead = white >= 50;
  const flipped = orientation === "black";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be styled as a two-tone vertical bar.
    <div
      role="meter"
      aria-label={t("evaluation")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(white)}
      aria-valuetext={`${label || t("even")}${badgeTitle ? ` (${badgeTitle})` : ""}`}
      className={cn(
        "relative min-w-6 overflow-hidden rounded-md bg-[var(--eval-black-bg)] ring-1 ring-inset ring-border",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 bg-[var(--eval-white-bg)] transition-[height] duration-[220ms] ease-out motion-reduce:transition-none",
          flipped ? "top-0" : "bottom-0",
        )}
        style={{ height: `${white}%` }}
      />
      <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--eval-midline)]" />
      {badge && (
        <span
          title={badgeTitle}
          className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded border border-black/20 bg-[var(--eval-tb-bg)] px-0.5 font-mono text-[8px] leading-3 font-bold text-[var(--eval-tb-fg)] shadow-xs"
        >
          {badge}
        </span>
      )}
      <span
        className={cn(
          "absolute inset-x-0 text-center font-mono text-[9px] font-bold leading-6 tracking-tighter tabular-nums sm:text-[10px]",
          whiteAhead !== flipped ? "bottom-0" : "top-0",
          whiteAhead ? "text-[var(--eval-white-fg)]" : "text-[var(--eval-black-fg)]",
        )}
      >
        {label}
      </span>
    </div>
  );
}
