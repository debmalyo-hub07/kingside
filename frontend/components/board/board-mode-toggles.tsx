// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ArrowLeftRight, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BoardInteractionMode } from "@/components/board/chess-board";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Optional mobile/touch mode toggles: Swipe Mode (step moves) & Pencil Draw Mode (arrows/circles). */
export function BoardModeToggles({
  mode,
  onModeChange,
  buttonClassName,
}: {
  mode: BoardInteractionMode;
  onModeChange: (next: BoardInteractionMode) => void;
  buttonClassName?: string;
}) {
  const t = useTranslations("board");
  const activeCls = "bg-primary/15 text-primary ring-1 ring-inset ring-primary/40 hover:bg-primary/20";
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn(buttonClassName, mode === "swipe" && activeCls)}
        aria-label={t("swipeMode")}
        title={t("swipeModeHint")}
        aria-pressed={mode === "swipe"}
        onClick={() => onModeChange(mode === "swipe" ? "play" : "swipe")}
      >
        <ArrowLeftRight />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(buttonClassName, mode === "draw" && activeCls)}
        aria-label={t("drawMode")}
        title={t("drawModeHint")}
        aria-pressed={mode === "draw"}
        onClick={() => onModeChange(mode === "draw" ? "play" : "draw")}
      >
        <Pencil />
      </Button>
    </>
  );
}
