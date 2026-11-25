// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/** On/off switch (Radix Switch: role="switch", keyboard + screen-reader friendly). */
export function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "sm" | "default" }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input shadow-inner transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        size === "sm" ? "h-4 w-7" : "h-5 w-9",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-md ring-0 transition-transform data-[state=unchecked]:translate-x-0.5 motion-reduce:transition-none",
          size === "sm"
            ? "size-3 data-[state=checked]:translate-x-3.5"
            : "size-4 data-[state=checked]:translate-x-[1.125rem]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

/** Switch with a clickable text label (and optional hint underneath). */
export function SwitchField({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className,
  size,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3 text-sm", disabled && "opacity-60", className)}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        size={size}
        className={hint ? "mt-0.5" : undefined}
      />
      <label htmlFor={id} className={cn("min-w-0 cursor-pointer", disabled && "cursor-not-allowed")}>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </label>
    </div>
  );
}
