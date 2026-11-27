// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Crosshair, HelpCircle, Keyboard, LineChart, Play, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { HintTooltip } from "@/components/ui/tooltip";

const REVIEW_SHORTCUT_ROWS: { keys: string[]; labelKey: string }[] = [
  { keys: ["←"], labelKey: "prev" },
  { keys: ["→"], labelKey: "next" },
  { keys: ["↑", "Home"], labelKey: "first" },
  { keys: ["↓", "End"], labelKey: "last" },
  { keys: ["Space"], labelKey: "nextKey" },
  { keys: ["R"], labelKey: "retry" },
  { keys: ["F"], labelKey: "flip" },
  { keys: ["S"], labelKey: "summary" },
  { keys: ["?"], labelKey: "guide" },
  { keys: ["Esc"], labelKey: "escape" },
];

const REVIEW_FEATURE_CARDS: {
  id: "motifs" | "retry" | "previews" | "playback";
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "motifs", icon: Crosshair },
  { id: "retry", icon: RotateCcw },
  { id: "previews", icon: LineChart },
  { id: "playback", icon: Play },
];

export function ReviewShortcutsGuideTrigger({
  onClick,
  className,
  showKeyPill = false,
}: {
  onClick: () => void;
  className?: string;
  showKeyPill?: boolean;
}) {
  const t = useTranslations("review.report.guide");
  return (
    <HintTooltip label={t("button")} shortcut="?" description={t("description")}>
      <Button
        variant="ghost"
        size={showKeyPill ? "sm" : "icon"}
        className={showKeyPill ? `gap-1 px-2 ${className ?? ""}` : className}
        aria-label={t("button")}
        onClick={onClick}
      >
        <HelpCircle className="size-4" />
        {showKeyPill && (
          <kbd className="rounded border bg-secondary px-1 py-px font-mono text-[10px] font-semibold text-foreground">
            ?
          </kbd>
        )}
      </Button>
    </HintTooltip>
  );
}

export function ReviewShortcutsGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("review.report.guide");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[88dvh] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
                <Keyboard className="size-5 text-primary" aria-hidden />
                {t("title")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {t("description")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("close")}>
                <X />
              </Button>
            </Dialog.Close>
          </div>

          <div className="space-y-5">
            <section aria-labelledby="ks-review-shortcuts-heading">
              <h3
                id="ks-review-shortcuts-heading"
                className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t("shortcutsTitle")}
              </h3>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {REVIEW_SHORTCUT_ROWS.map((row) => (
                  <div
                    key={row.labelKey}
                    className="flex items-center justify-between gap-3 rounded-xl border bg-surface-well/60 px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-foreground">
                      {t(`shortcuts.${row.labelKey}` as never)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-6 rounded-md border bg-card px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-foreground shadow-2xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="ks-review-features-heading">
              <h3
                id="ks-review-features-heading"
                className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t("featuresTitle")}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {REVIEW_FEATURE_CARDS.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.id}
                      className="flex items-start gap-2.5 rounded-xl border bg-surface-well/45 p-3"
                    >
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">
                          {t(`features.${card.id}.title` as never)}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {t(`features.${card.id}.text` as never)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
