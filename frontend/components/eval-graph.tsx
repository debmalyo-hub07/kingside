// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface GraphMarker {
  index: number;
  color: string;
  label: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** White-POV win % area chart. Click/drag (or arrow keys on the slider) to seek. */
export function EvalGraph({
  whiteWin,
  index,
  onSeek,
  markers = [],
  className,
}: {
  whiteWin: readonly number[];
  index: number;
  onSeek: (index: number) => void;
  markers?: GraphMarker[];
  className?: string;
}) {
  const t = useTranslations("board");
  const last = Math.max(whiteWin.length - 1, 1);
  const pts = whiteWin.map((w, i) => [round((i / last) * 100), round(100 - w)] as const);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const [px] = pts[index] ?? [0, 50];
  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-neutral-900", className)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-20 w-full" aria-hidden>
        <polygon points={`0,100 ${line} 100,100`} className="fill-neutral-100" />
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke="#f5c56b"
          strokeOpacity="0.5"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />
        {markers.map((m) => {
          const p = pts[m.index];
          return p ? (
            <line
              key={m.index}
              x1={p[0]}
              x2={p[0]}
              y1="0"
              y2="100"
              stroke={m.color}
              strokeOpacity="0.55"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ) : null;
        })}
        <line
          x1={px}
          y1="0"
          x2={px}
          y2="100"
          stroke="#34d399"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <input
        type="range"
        min={0}
        max={whiteWin.length - 1}
        value={index}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label={t("graph")}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </div>
  );
}
