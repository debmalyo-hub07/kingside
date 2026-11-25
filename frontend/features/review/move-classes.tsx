// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside's own move-classification badges: glyphs + colors (not Chess.com artwork; docs/LICENSING.md).

import type { MoveClass } from "@kingside/chess-core";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

export const CLASS_META: Record<MoveClass, { label: string; glyph: string; color: string; text: string }> = {
  brilliant: { label: "Brilliant", glyph: "!!", color: "#f5c56b", text: "#2a1c00" },
  great: { label: "Great", glyph: "!", color: "#a78bfa", text: "#1b1033" },
  best: { label: "Best", glyph: "★", color: "#34d399", text: "#03251a" },
  excellent: { label: "Excellent", glyph: "✓", color: "#5eead4", text: "#042a26" },
  good: { label: "Good", glyph: "+", color: "#a3e635", text: "#1a2600" },
  book: { label: "Book", glyph: "≡", color: "#c4a484", text: "#2a1a0c" },
  forced: { label: "Forced", glyph: "→", color: "#94a3b8", text: "#0f172a" },
  inaccuracy: { label: "Inaccuracy", glyph: "?!", color: "#facc15", text: "#2a2200" },
  mistake: { label: "Mistake", glyph: "?", color: "#fb923c", text: "#2c1300" },
  miss: { label: "Miss", glyph: "×", color: "#f472b6", text: "#2f0a1d" },
  blunder: { label: "Blunder", glyph: "??", color: "#ef4444", text: "#ffffff" },
};

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
      className={cn(
        "inline-grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] leading-none font-black shadow-sm",
        className,
      )}
      style={{ backgroundColor: meta.color, color: meta.text }}
    >
      {meta.glyph}
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
      className="pointer-events-none absolute z-10 grid aspect-square -translate-x-[65%] -translate-y-[35%] animate-in zoom-in-50 duration-200 motion-reduce:animate-none"
      style={{ left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%`, width: "max(1.25rem, 5.5%)" }}
    >
      <MoveClassBadge
        cls={cls}
        className="size-full text-[clamp(8px,1.4vw,13px)] shadow-md ring-2 ring-background"
      />
    </span>
  );
}
