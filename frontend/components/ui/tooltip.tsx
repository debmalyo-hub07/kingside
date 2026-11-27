// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function TooltipProvider({
  delayDuration = 250,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 max-w-64 rounded-xl border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-border" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/** Crisp Midnight Emerald tooltip with optional keyboard shortcut pill and 1-line feature hint. */
export function HintTooltip({
  label,
  shortcut,
  description,
  side = "top",
  children,
}: {
  label: string;
  shortcut?: string;
  description?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          {shortcut && (
            <kbd className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
              {shortcut}
            </kbd>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
