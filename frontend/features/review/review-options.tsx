// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { SwitchField } from "@/components/ui/switch";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

/** Review display toggles (also on the settings page). */
export function ReviewOptionFields() {
  const s = useSettings();
  const t = useTranslations("reviewOptions");
  return (
    <div className="space-y-3">
      <SwitchField
        checked={s.reviewBadges}
        onCheckedChange={(v) => s.update({ reviewBadges: v })}
        label={t("badges")}
      />
      <SwitchField
        checked={s.reviewBestArrow}
        onCheckedChange={(v) => s.update({ reviewBestArrow: v })}
        label={t("bestArrow")}
      />
      <SwitchField
        checked={s.reviewThreatArrow}
        onCheckedChange={(v) => s.update({ reviewThreatArrow: v })}
        label={t("threatArrow")}
        hint={t("threatArrowHint")}
      />
      <SwitchField
        checked={s.reviewMoveTimes}
        onCheckedChange={(v) => s.update({ reviewMoveTimes: v })}
        label={t("moveTimes")}
        hint={t("moveTimesHint")}
      />
      <fieldset className="text-sm">
        <legend className="mb-1.5">{t("keyFor")}</legend>
        <div className="flex gap-1">
          {(["both", "white", "black"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={s.reviewKeyFor === v}
              onClick={() => s.update({ reviewKeyFor: v })}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition",
                s.reviewKeyFor === v
                  ? "border-primary bg-primary/15"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`keyForOptions.${v}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="text-sm">
        <legend className="mb-1.5">{t("metric")}</legend>
        <div className="flex gap-1">
          {(["accuracy", "precision"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={s.reviewMetric === v}
              onClick={() => s.update({ reviewMetric: v })}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition",
                s.reviewMetric === v
                  ? "border-primary bg-primary/15"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`metricOptions.${v}`)}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function ReviewOptions() {
  const t = useTranslations("reviewOptions");
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("title")} title={t("title")}>
          <SlidersHorizontal />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          <p className="mb-3 text-sm font-semibold">{t("title")}</p>
          <ReviewOptionFields />
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
