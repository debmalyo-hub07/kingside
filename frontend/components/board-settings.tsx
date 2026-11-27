// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Palette, X } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { BOARD_THEMES } from "@/lib/board-themes";
import { PIECE_SETS, pieceUrl } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

const ANIMATION_OPTIONS = [
  { label: "off", ms: 0 },
  { label: "fast", ms: 120 },
  { label: "normal", ms: 200 },
  { label: "slow", ms: 350 },
] as const;

/** Palette, piece set, coordinates, arrows and animation controls (dialog + settings page). */
export function BoardAppearanceFields() {
  const s = useSettings();
  const tr = useTranslations("board");
  const animId = useId();
  return (
    <>
      <h3 className="mb-2 text-sm font-medium">{tr("board")}</h3>
      <div className="mb-5 grid grid-cols-5 gap-2">
        {BOARD_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => s.update({ boardTheme: t.id })}
            aria-pressed={s.boardTheme === t.id}
            className={cn(
              "group rounded-lg p-1 text-xs ring-offset-2 ring-offset-card transition hover:bg-accent",
              s.boardTheme === t.id && "ring-2 ring-primary",
            )}
          >
            <span
              className="block aspect-square w-full rounded-md"
              style={{
                backgroundImage: `repeating-conic-gradient(${t.dark} 0 25%, ${t.light} 0 50%)`,
                backgroundSize: "50% 50%",
              }}
            />
            <span className="mt-1 block truncate">{tr(`themes.${t.id}`)}</span>
          </button>
        ))}
      </div>

      <h3 className="mb-2 text-sm font-medium">{tr("pieces")}</h3>
      <div className="mb-5 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {PIECE_SETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => s.update({ pieceSet: p.id })}
            aria-pressed={s.pieceSet === p.id}
            className={cn(
              "rounded-lg p-1 text-xs ring-offset-2 ring-offset-card transition hover:bg-accent",
              s.pieceSet === p.id && "ring-2 ring-primary",
            )}
          >
            <span className="flex aspect-square w-full items-center justify-center rounded-md bg-secondary">
              <Image
                src={pieceUrl(p.id, "white", "knight")}
                alt=""
                width={40}
                height={40}
                loading="eager"
                unoptimized
                className="size-4/5"
              />
            </span>
            <span className="mt-1 block truncate">{p.name}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <SwitchField
          checked={s.coordinates}
          onCheckedChange={(v) => s.update({ coordinates: v })}
          label={tr("coordinates")}
          className="items-center"
        />
        <SwitchField
          checked={s.showBestArrow}
          onCheckedChange={(v) => s.update({ showBestArrow: v })}
          label={tr("arrows")}
          className="items-center"
        />
        <div className="flex items-center gap-2">
          <label htmlFor={animId} className="cursor-pointer">
            {tr("animation")}
          </label>
          <Select value={String(s.animationMs)} onValueChange={(v) => s.update({ animationMs: Number(v) })}>
            <SelectTrigger id={animId} size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANIMATION_OPTIONS.map((o) => (
                <SelectItem key={o.ms} value={String(o.ms)}>
                  {tr(`speed.${o.label}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}

/** Board appearance dialog: palette, piece set, coordinates, animation. */
export function BoardSettings({
  className,
  open,
  onOpenChange,
  trigger,
}: {
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Custom trigger; `null` = no trigger (controlled dialog). */
  trigger?: React.ReactNode | null;
} = {}) {
  const tr = useTranslations("board");
  return (
    <Dialog.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger !== null &&
        (trigger ? (
          <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        ) : (
          <TooltipProvider delayDuration={250}>
            <HintTooltip label={tr("title")} description={tr("description")}>
              <Dialog.Trigger asChild>
                <Button variant="ghost" size="icon" className={className} aria-label={tr("title")}>
                  <Palette />
                </Button>
              </Dialog.Trigger>
            </HintTooltip>
          </TooltipProvider>
        ))}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{tr("title")}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={tr("close")}>
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{tr("description")}</Dialog.Description>

          <BoardAppearanceFields />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
