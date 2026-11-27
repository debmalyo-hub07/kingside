// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside's own 11-class semantic badges & bespoke inline SVG glyphs (docs/LICENSING.md).

import type { MoveClass } from "@kingside/chess-core";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

export interface MoveClassMeta {
  label: string;
  glyph: string;
  color: string;
  text: string;
  ring: string;
}

export const CLASS_META: Record<MoveClass, MoveClassMeta> = {
  brilliant: { label: "Brilliant", glyph: "!!", color: "#22d3ee", text: "#042f2e", ring: "#0e7490" },
  great: { label: "Great", glyph: "!", color: "#4f46e5", text: "#ffffff", ring: "#3730a3" },
  best: { label: "Best", glyph: "★", color: "#10b981", text: "#022c22", ring: "#047857" },
  excellent: { label: "Excellent", glyph: "✓", color: "#38bdf8", text: "#082f49", ring: "#0369a1" },
  good: { label: "Good", glyph: "+", color: "#a3e635", text: "#1a2600", ring: "#4d7c0f" },
  book: { label: "Book", glyph: "≡", color: "#d4a373", text: "#2a1a0c", ring: "#8b5500" },
  forced: { label: "Forced", glyph: "→", color: "#94a3b8", text: "#0f172a", ring: "#475569" },
  inaccuracy: { label: "Inaccuracy", glyph: "?!", color: "#fbbf24", text: "#2a1a00", ring: "#92400e" },
  mistake: { label: "Mistake", glyph: "?", color: "#fb923c", text: "#2c1300", ring: "#c2410c" },
  miss: { label: "Miss", glyph: "×", color: "#e11d48", text: "#ffffff", ring: "#9f1239" },
  blunder: { label: "Blunder", glyph: "??", color: "#dc2626", text: "#ffffff", ring: "#991b1b" },
};

/** Bespoke geometric Kingside vector glyphs on a unified 24x24 grid. */
export function MoveClassIcon({ cls, className }: { cls: MoveClass; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-[72%] shrink-0", className)}>
      {renderClassGlyph(cls)}
    </svg>
  );
}

function renderClassGlyph(cls: MoveClass) {
  switch (cls) {
    case "brilliant":
      return (
        <>
          <path d="M7.1 4.4h2.9l-.45 9.3h-2L7.1 4.4Zm6.9 0h2.9l-.45 9.3h-2L14 4.4Z" fill="currentColor" />
          <circle cx="8.55" cy="17.85" r="1.65" fill="currentColor" />
          <circle cx="15.45" cy="17.85" r="1.65" fill="currentColor" />
        </>
      );
    case "great":
      return (
        <>
          <path d="M10.35 4.2h3.3l-.52 10.4h-2.26L10.35 4.2Z" fill="currentColor" />
          <circle cx="12" cy="18.25" r="1.85" fill="currentColor" />
        </>
      );
    case "best":
      return (
        <path
          d="M12 3.7l2.25 5.05 5.5.52-4.12 3.66 1.22 5.38L12 15.5l-4.85 2.81 1.22-5.38-4.12-3.66 5.5-.52L12 3.7Z"
          fill="currentColor"
        />
      );
    case "excellent":
      return (
        <path
          d="M5.4 12.6l4.2 4.2 9-9.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "good":
      return (
        <path
          d="M12 5.4v13.2M5.4 12h13.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.1"
          strokeLinecap="round"
        />
      );
    case "book":
      return (
        <path
          d="M4.6 6.6c2.2 0 5.1.72 7.4 2.15 2.3-1.43 5.2-2.15 7.4-2.15v10.8c-2.2 0-5.1.72-7.4 2.15-2.3-1.43-5.2-2.15-7.4-2.15V6.6ZM12 8.75v10.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "forced":
      return (
        <path
          d="M5 12h13.4M13.5 6.8L18.8 12l-5.3 5.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "inaccuracy":
      return (
        <>
          <path
            d="M5.4 8.3a3 3 0 0 1 5.65 1.2c0 1.85-2.3 2.25-2.3 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="8.75" cy="17.75" r="1.45" fill="currentColor" />
          <path d="M15.4 5h2.7l-.42 8.7h-1.86L15.4 5Z" fill="currentColor" />
          <circle cx="16.75" cy="17.75" r="1.45" fill="currentColor" />
        </>
      );
    case "mistake":
      return (
        <>
          <path
            d="M8.5 8.2a3.7 3.7 0 0 1 7.2 1.25c0 2.25-2.95 2.75-2.95 4.85"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.9"
            strokeLinecap="round"
          />
          <circle cx="12.75" cy="18.3" r="1.7" fill="currentColor" />
        </>
      );
    case "miss":
      return (
        <path
          d="M6.8 6.8l10.4 10.4M17.2 6.8L6.8 17.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.1"
          strokeLinecap="round"
        />
      );
    case "blunder":
      return (
        <>
          <path
            d="M4.6 8.3a2.9 2.9 0 0 1 5.55 1.15c0 1.75-2.25 2.2-2.25 3.95"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
          <circle cx="7.9" cy="17.65" r="1.38" fill="currentColor" />
          <path
            d="M13.25 8.3a2.9 2.9 0 0 1 5.55 1.15c0 1.75-2.25 2.2-2.25 3.95"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
          <circle cx="16.55" cy="17.65" r="1.38" fill="currentColor" />
        </>
      );
  }
}

/** Translated class names ("Blunder", …). English `label` in CLASS_META stays as a fallback for tools. */
export function useClassLabel(): (cls: MoveClass) => string {
  const t = useTranslations("classes");
  return useCallback((cls: MoveClass) => t(cls), [t]);
}

export function MoveClassBadge({ cls, className }: { cls: MoveClass; className?: string }) {
  const meta = CLASS_META[cls];
  const label = useClassLabel()(cls);
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      data-move-class={cls}
      className={cn(
        "inline-grid size-5 shrink-0 place-items-center rounded-full border shadow-sm",
        className,
      )}
      style={{
        backgroundColor: `var(--class-${cls}-bg, ${meta.color})`,
        color: `var(--class-${cls}-fg, ${meta.text})`,
        borderColor: `var(--class-${cls}-ring, ${meta.ring})`,
      }}
    >
      <MoveClassIcon cls={cls} />
    </span>
  );
}

/** Square a move lands on, for placing its badge (castling → the king's destination, not the rook). */
export function badgeSquare(uci: string, san: string): string {
  if (san.startsWith("O-O")) {
    const rank = uci[1] ?? "1";
    return `${san.startsWith("O-O-O") ? "c" : "g"}${rank}`;
  }
  return uci.slice(2, 4);
}

/** Classification badge pinned to the top-right corner of a board square (place inside the board's box). */
export function SquareBadge({
  cls,
  square,
  orientation,
}: {
  cls: MoveClass;
  square: string;
  orientation: "white" | "black";
}) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  return (
    <span
      className="pointer-events-none absolute z-10 grid aspect-square -translate-x-[65%] -translate-y-[35%] animate-in fade-in zoom-in-50 duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:animate-none"
      style={{ left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%`, width: "clamp(18px, 5.6cqw, 36px)" }}
    >
      <MoveClassBadge cls={cls} className="size-full shadow-md ring-2 ring-background" />
    </span>
  );
}
