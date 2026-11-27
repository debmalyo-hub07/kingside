// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface GraphMarker {
  index: number;
  color: string;
  ringColor?: string;
  label: string;
  san?: string;
  scoreLabel?: string;
}

export interface GraphPointMeta {
  san?: string;
  scoreLabel?: string;
  classification?: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Fritsch-Carlson monotone cubic spline in SVG viewBox [0..100, 0..100].
 * Smooth through every sample with zero overshoot above/below bounds.
 */
export function buildSmoothGraphPaths(pts: readonly (readonly [number, number])[]): {
  linePath: string;
  areaPath: string;
} {
  if (pts.length === 0) return { linePath: "", areaPath: "" };
  const first = pts[0];
  if (!first) return { linePath: "", areaPath: "" };
  if (pts.length === 1) {
    const y = round(first[1]);
    return {
      linePath: `M0,${y} L100,${y}`,
      areaPath: `M0,${y} L100,${y} L100,100 L0,100 Z`,
    };
  }
  if (pts.length === 2) {
    const second = pts[1];
    if (!second) return { linePath: "", areaPath: "" };
    const line = `M${round(first[0])},${round(first[1])} L${round(second[0])},${round(second[1])}`;
    return { linePath: line, areaPath: `${line} L${round(second[0])},100 L${round(first[0])},100 Z` };
  }

  const n = pts.length;
  const slopes: number[] = new Array(n - 1).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    slopes[i] = dx > 0 ? (b[1] - a[1]) / dx : 0;
  }

  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = slopes[0] ?? 0;
  tangents[n - 1] = slopes[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const s0 = slopes[i - 1] ?? 0;
    const s1 = slopes[i] ?? 0;
    tangents[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    const d = slopes[i] ?? 0;
    if (d === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const a = (tangents[i] ?? 0) / d;
      const b = (tangents[i + 1] ?? 0) / d;
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        tangents[i] = tau * a * d;
        tangents[i + 1] = tau * b * d;
      }
    }
  }

  let linePath = `M${round(first[0])},${round(first[1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    if (!p0 || !p1) continue;
    const dx = (p1[0] - p0[0]) / 3;
    const c1x = round(p0[0] + dx);
    const c1y = round(clamp(p0[1] + (tangents[i] ?? 0) * dx, 0, 100));
    const c2x = round(p1[0] - dx);
    const c2y = round(clamp(p1[1] - (tangents[i + 1] ?? 0) * dx, 0, 100));
    linePath += ` C${c1x},${c1y} ${c2x},${c2y} ${round(p1[0])},${round(p1[1])}`;
  }
  const lastPt = pts[n - 1] ?? first;
  const areaPath = `${linePath} L${round(lastPt[0])},100 L${round(first[0])},100 Z`;
  return { linePath, areaPath };
}

/** Resolves the target ply index from a pointer X position, snapping to markers within 6px. */
export function resolveGraphIndex(params: {
  localX: number;
  width: number;
  count: number;
  markers: readonly Pick<GraphMarker, "index">[];
  snapMarkers: boolean;
}): number {
  const { width, count, markers, snapMarkers } = params;
  if (count <= 1) return 0;
  const w = Math.max(width, 1);
  const last = count - 1;
  const x = clamp(params.localX, 0, w);
  if (snapMarkers && markers.length > 0) {
    let bestIdx: number | null = null;
    let bestDist = 6;
    for (const m of markers) {
      const mx = (m.index / last) * w;
      const dist = Math.abs(x - mx);
      if (dist <= bestDist) {
        bestDist = dist;
        bestIdx = m.index;
      }
    }
    if (bestIdx !== null) return bestIdx;
  }
  return clamp(Math.round((x / w) * last), 0, last);
}

/** White-POV win % smooth area chart. Click/drag, click markers, or use arrow keys to seek. */
export function EvalGraph({
  whiteWin,
  index,
  onSeek,
  markers = [],
  meta,
  compact = false,
  className,
}: {
  whiteWin: readonly number[];
  index: number;
  onSeek: (index: number) => void;
  markers?: GraphMarker[];
  meta?: readonly (GraphPointMeta | undefined)[];
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("board");
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const last = Math.max(whiteWin.length - 1, 1);
  const pts = useMemo(
    () => whiteWin.map((w, i) => [round((i / last) * 100), round(clamp(100 - w, 0, 100))] as const),
    [whiteWin, last],
  );
  const { linePath, areaPath } = useMemo(() => buildSmoothGraphPaths(pts), [pts]);
  const markerMap = useMemo(() => new Map(markers.map((m) => [m.index, m])), [markers]);

  const activePt = pts[index] ?? [0, 50];
  const tipIndex = hoverIndex ?? (scrubbing ? index : null);
  const tipPt = tipIndex !== null ? pts[tipIndex] : null;
  const tipMeta = tipIndex !== null ? meta?.[tipIndex] : undefined;
  const tipMarker = tipIndex !== null ? markerMap.get(tipIndex) : undefined;
  const tipSan = tipMeta?.san ?? tipMarker?.san;
  const tipScore =
    tipMeta?.scoreLabel ??
    tipMarker?.scoreLabel ??
    (tipIndex !== null ? t("graphWinPct", { pct: Math.round(whiteWin[tipIndex] ?? 50) }) : "");
  const tipClass = tipMeta?.classification ?? tipMarker?.label;

  const resolveIndexFromPointer = (clientX: number, snapMarkers: boolean): number => {
    const el = containerRef.current;
    if (!el || whiteWin.length <= 1) return 0;
    const rect = el.getBoundingClientRect();
    return resolveGraphIndex({
      localX: clientX - rect.left,
      width: rect.width,
      count: whiteWin.length,
      markers,
      snapMarkers,
    });
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative select-none rounded-xl border bg-[var(--eval-graph-bg)]", className)}
    >
      <div className="relative overflow-hidden rounded-[inherit]">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className={cn("block w-full", compact ? "h-9 md:h-20" : "h-20")}
          aria-hidden
        >
          {areaPath && <path d={areaPath} fill="var(--eval-graph-white)" />}
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            stroke="var(--eval-midline)"
            strokeWidth="0.75"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--eval-graph-stroke)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {markers.map((m) => {
            const p = pts[m.index];
            return p ? (
              <line
                key={m.index}
                x1={p[0]}
                x2={p[0]}
                y1={p[1]}
                y2="100"
                stroke={m.color}
                strokeOpacity="0.65"
                strokeWidth="1.75"
                vectorEffect="non-scaling-stroke"
              />
            ) : null;
          })}
          <line
            x1={activePt[0]}
            y1="0"
            x2={activePt[0]}
            y2="100"
            stroke="var(--primary)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {markers.map((m) => {
          const p = pts[m.index];
          if (!p) return null;
          const active = m.index === index || m.index === tipIndex;
          return (
            <span
              key={`dot-${m.index}`}
              aria-hidden
              className={cn(
                "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-xs transition-transform",
                active ? "size-2.5 scale-110" : "size-2",
              )}
              style={{
                left: `${p[0]}%`,
                top: `${p[1]}%`,
                backgroundColor: m.color,
                borderColor: m.ringColor ?? "var(--background)",
              }}
            >
              {active && (
                <span
                  className="absolute -inset-1 rounded-full opacity-55 animate-ping motion-reduce:hidden"
                  style={{ backgroundColor: m.color }}
                />
              )}
            </span>
          );
        })}

        <span
          aria-hidden
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
          style={{ left: `${activePt[0]}%`, top: `${activePt[1]}%` }}
        />
      </div>

      {tipIndex !== null && tipPt && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-9 z-20 flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-lg border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md"
          style={{ left: `${tipPt[0]}%`, transform: `translateX(-${tipPt[0]}%)` }}
        >
          <span className="font-mono font-semibold">
            {tipIndex === 0 ? t("graphStart") : (tipSan ?? `#${tipIndex}`)}
          </span>
          {tipScore && <span className="font-mono text-muted-foreground">{tipScore}</span>}
          {tipClass && (
            <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-px text-[10px] font-semibold text-secondary-foreground">
              {tipMarker && (
                <span
                  className="size-1.5 shrink-0 rounded-full border"
                  style={{
                    backgroundColor: tipMarker.color,
                    borderColor: tipMarker.ringColor ?? tipMarker.color,
                  }}
                />
              )}
              <span>{tipClass}</span>
            </span>
          )}
        </div>
      )}

      <input
        type="range"
        min={0}
        max={Math.max(whiteWin.length - 1, 0)}
        value={index}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === "mouse") return;
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic pointer events in automated environments may lack an active pointerId.
          }
          setScrubbing(true);
          const next = resolveIndexFromPointer(e.clientX, true);
          setHoverIndex(next);
          onSeek(next);
        }}
        onPointerMove={(e) => {
          if (scrubbing) {
            const next = resolveIndexFromPointer(e.clientX, false);
            setHoverIndex(next);
            onSeek(next);
            return;
          }
          if (e.pointerType === "mouse") {
            setHoverIndex(resolveIndexFromPointer(e.clientX, true));
          }
        }}
        onPointerLeave={() => {
          if (!scrubbing) setHoverIndex(null);
        }}
        onPointerUp={(e) => {
          setScrubbing(false);
          if (e.pointerType !== "mouse") setHoverIndex(null);
        }}
        onPointerCancel={() => {
          setScrubbing(false);
          setHoverIndex(null);
        }}
        onBlur={() => {
          if (!scrubbing) setHoverIndex(null);
        }}
        onChange={(e) => {
          const next = Number(e.target.value);
          setHoverIndex(next);
          onSeek(next);
        }}
        aria-label={t("graph")}
        className="absolute inset-0 z-10 size-full cursor-pointer touch-none opacity-0"
      />
    </div>
  );
}
