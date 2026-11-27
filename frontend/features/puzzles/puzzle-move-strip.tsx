// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { HintTooltip } from "@/components/ui/tooltip";
import { formatSan } from "@/lib/notation";
import { scrollChildIntoContainer } from "@/lib/scroll-container";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import type { PuzzleState } from "./use-puzzle";

export function PuzzleMoveStrip({
  state,
  scrollContainerRef,
}: {
  state: PuzzleState;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("puzzles");
  const notation = useSettings((s) => s.notation);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-step="${state.viewStep}"]`);
    scrollChildIntoContainer(scrollContainerRef?.current, el);
  }, [state.viewStep, scrollContainerRef]);

  if (state.history.length === 0) return null;

  return (
    <div ref={stripRef} className="space-y-1.5 rounded-xl bg-secondary/40 p-2">
      <div className="flex items-center justify-between gap-1">
        <div role="toolbar" aria-label={t("moves")} className="flex items-center gap-0.5">
          <HintTooltip label={t("first")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("first")}
              disabled={state.viewStep <= 0}
              onClick={() => state.goToStep(0)}
            >
              <ChevronFirst className="size-3.5" />
            </Button>
          </HintTooltip>
          <HintTooltip label={t("previous")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("previous")}
              disabled={state.viewStep <= 0}
              onClick={() => state.goToStep(state.viewStep - 1)}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
          </HintTooltip>
          <HintTooltip label={t("nextMove")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("nextMove")}
              disabled={!state.viewingHistory}
              onClick={() => state.goToStep(state.viewStep + 1)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </HintTooltip>
          <HintTooltip label={t("last")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("last")}
              disabled={!state.viewingHistory}
              onClick={() => state.goToStep(null)}
            >
              <ChevronLast className="size-3.5" />
            </Button>
          </HintTooltip>
        </div>
        {state.viewingHistory && (
          <span className="rounded-md border bg-popover px-1.5 py-0.5 text-[11px] font-medium text-popover-foreground">
            {t("previewBadge")}
          </span>
        )}
      </div>
      <ol aria-label={t("moves")} className="flex flex-wrap gap-1 font-mono text-xs">
        {state.history.map((item) => {
          const active = state.viewStep === item.index;
          const prefix =
            item.color === "white"
              ? `${item.fullmoves}.`
              : item.isSetup || item.index === 1
                ? `${item.fullmoves}…`
                : "";
          return (
            <li key={item.index}>
              <button
                type="button"
                data-step={item.index}
                aria-current={active ? "true" : undefined}
                onClick={() => state.goToStep(item.index >= state.liveStep ? null : item.index)}
                className={cn(
                  "rounded-md px-1.5 py-0.5 transition motion-reduce:transition-none hover:bg-accent",
                  active
                    ? "bg-primary font-semibold text-primary-foreground hover:bg-primary"
                    : item.isSetup
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                {prefix && <span className="mr-0.5">{prefix}</span>}
                {formatSan(item.san, notation, item.color)}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
