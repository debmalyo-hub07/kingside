// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Color, labelWinFromScore, type Score, winPercentFor } from "@kingside/chess-core";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { parseSquare } from "chessops/util";
import { formatScore } from "@/components/eval-bar";

export type CandidateArrowBrush =
  | "candBest"
  | "candCyan"
  | "candTeal"
  | "candAmber"
  | "candOrange"
  | "candRose";

export interface CandidateLineInput {
  pv: readonly string[];
  score: Score;
}

const BRUSH_STYLE: Record<
  CandidateArrowBrush,
  { lineWidth: number; pillBg: string; pillBorder: string; pillText: string }
> = {
  candBest: {
    lineWidth: 12,
    pillBg: "#064e3b",
    pillBorder: "#34d399",
    pillText: "#ecfdf5",
  },
  candCyan: {
    lineWidth: 10,
    pillBg: "#0c2231",
    pillBorder: "#22d3ee",
    pillText: "#ecfeff",
  },
  candTeal: {
    lineWidth: 9,
    pillBg: "#0a2422",
    pillBorder: "#2dd4bf",
    pillText: "#f0fdfa",
  },
  candAmber: {
    lineWidth: 8,
    pillBg: "#261a07",
    pillBorder: "#fbbf24",
    pillText: "#fffbeb",
  },
  candOrange: {
    lineWidth: 7,
    pillBg: "#281508",
    pillBorder: "#fb923c",
    pillText: "#fff7ed",
  },
  candRose: {
    lineWidth: 7,
    pillBg: "#290d16",
    pillBorder: "#fb7185",
    pillText: "#fff1f2",
  },
};

function formatCandidateScore(score: Score): string {
  const text = formatScore(score);
  return text === "-0.0" ? "0.0" : text;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isValidSquareKey(sq: string): sq is Key {
  return sq.length === 2 && parseSquare(sq) !== undefined;
}

function keyToScreenPos(key: Key, orientation: Color): [number, number] {
  const file = key.charCodeAt(0) - 97;
  const rank = key.charCodeAt(1) - 49;
  const ox = orientation === "white" ? file : 7 - file;
  const oy = orientation === "white" ? rank : 7 - rank;
  return [ox - 3.5, 3.5 - oy];
}

function moveAngleSlot(from: [number, number], to: [number, number]): number {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]) + Math.PI;
  return (Math.round((angle * 8) / Math.PI) + 16) % 16;
}

/** Mirrors Chessground's `labelCoords` geometry in centered [-3.5, +3.5] board-square units. */
function estimateLabelPos(
  from: [number, number],
  to: [number, number],
  slots: Set<number> | undefined,
): [number, number] {
  let mag = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]) + Math.PI;
  if (slots) {
    mag -= 33 / 64;
    if (slots.size > 1) {
      mag -= 10 / 64;
      const slot = moveAngleSlot(from, to);
      if ((slots.has((slot + 1) % 16) || slots.has((slot + 15) % 16)) && (slot & 1) === 1) {
        mag -= 0.4;
      }
    }
  }
  return [from[0] - Math.cos(angle) * mag, from[1] - Math.sin(angle) * mag];
}

/**
 * Classifies a candidate line relative to `best` (`lines[0]`) using mover-POV expected-points loss
 * (`labelWinFromScore` + `winPercentFor`) and forced-mate / missed-mate rules matching `@kingside/chess-core`.
 */
export function classifyCandidateBrush(
  line: CandidateLineInput,
  best: CandidateLineInput,
  index: number,
  turn: Color,
): CandidateArrowBrush {
  if (index === 0) return "candBest";

  const bestWin = winPercentFor(turn, labelWinFromScore(best.score));
  const candWin = winPercentFor(turn, labelWinFromScore(line.score));
  const epLoss = Math.max(0, bestWin - candWin) / 100;

  const sign = turn === "white" ? 1 : -1;
  const bestMate = best.score.mate !== undefined ? best.score.mate * sign : undefined;
  const candMate = line.score.mate !== undefined ? line.score.mate * sign : undefined;

  // Candidate allows opponent forced mate.
  if (candMate !== undefined && candMate < 0) {
    if (bestMate !== undefined && bestMate < 0) {
      // Negative mate count is moves until opponent mates: -1 is faster (worse) than -6.
      if (candMate <= bestMate) return "candCyan";
      const faster = candMate - bestMate;
      if (faster <= 2) return "candAmber";
      if (faster <= 4) return "candOrange";
      return "candRose";
    }
    if (bestWin >= 5) return "candRose";
  }

  // Best move has a forced mate for the mover.
  if (bestMate !== undefined && bestMate > 0) {
    if (candMate !== undefined && candMate > 0) {
      const extra = candMate - bestMate;
      if (extra <= 0) return "candCyan";
      if (extra <= 2) return "candTeal";
      if (extra <= 5) return "candAmber";
      return "candOrange";
    }
    // Missed forced mate into a non-mating line (matches review.ts missedForcedMate threshold).
    return candWin < 30 ? "candRose" : "candOrange";
  }

  if (epLoss <= 0.02) return "candCyan";
  if (epLoss <= 0.05) return "candTeal";
  if (epLoss <= 0.1) return "candAmber";
  if (epLoss <= 0.2) return "candOrange";
  return "candRose";
}

function buildPillSvg(labelText: string, brush: CandidateArrowBrush, dxSvg: number, dySvg: number): string {
  const { pillBg, pillBorder, pillText } = BRUSH_STYLE[brush];
  const width = Math.min(72, Math.max(38, labelText.length * 10 + 16));
  const height = 24;
  const cx = 50 + dxSvg;
  const cy = 50 + dySvg;
  const x = cx - width / 2;
  const y = cy - height / 2;
  const safeText = escapeXml(labelText);

  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" ` +
    `fill="${pillBg}" fill-opacity="0.94" stroke="${pillBorder}" stroke-width="2.5" />` +
    `<text x="${cx}" y="${cy}" fill="${pillText}" font-size="14.5" font-weight="700" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" ` +
    `text-anchor="middle" dominant-baseline="central">${safeText}</text>`
  );
}

interface CandidateEntry {
  orig: Key;
  dest: Key;
  brush: CandidateArrowBrush;
  scoreText: string;
  from: [number, number];
  to: [number, number];
}

interface PlacedPill {
  x: number;
  y: number;
  w: number;
  h: number;
}

function collides(x: number, y: number, w: number, h: number, placed: readonly PlacedPill[]): boolean {
  return placed.some((p) => Math.abs(x - p.x) < (w + p.w) * 0.56 && Math.abs(y - p.y) < (h + p.h) * 0.62);
}

function minClearance(x: number, y: number, placed: readonly PlacedPill[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of placed) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Builds Chessground `DrawShape[]` for `1..N` candidate engine lines:
 * - Deduplicates `orig+dest` underpromotions cleanly (keeping the highest-ranked line per arrow).
 * - Colors and weights arrows by mover-POV expected-points loss & mate logic.
 * - Places compact collision-aware numeric eval pills via `customSvg` (`center: "label"`).
 * - Returns shapes ordered worst-to-best so Line 1 paints on top.
 */
export function buildCandidateArrowShapes({
  lines,
  turn,
  orientation,
  extraShapes = [],
}: {
  lines: readonly CandidateLineInput[];
  turn: Color;
  orientation: Color;
  /** Other arrows drawn alongside candidates (e.g., Threat arrows) so dest-slot shortening stays accurate. */
  extraShapes?: readonly DrawShape[];
}): DrawShape[] {
  let bestLine: CandidateLineInput | undefined;
  const seenOrigDest = new Set<string>();
  const entries: CandidateEntry[] = [];

  for (const line of lines) {
    if (!line) continue;
    const uci = line.pv[0];
    if (!uci || uci.length < 4) continue;
    const orig = uci.slice(0, 2);
    const dest = uci.slice(2, 4);
    if (!isValidSquareKey(orig) || !isValidSquareKey(dest) || orig === dest) continue;
    const key = `${orig}:${dest}`;
    if (seenOrigDest.has(key)) continue;
    seenOrigDest.add(key);

    if (!bestLine) bestLine = line;
    const rankIndex = entries.length;
    entries.push({
      orig,
      dest,
      brush: classifyCandidateBrush(line, bestLine, rankIndex, turn),
      scoreText: formatCandidateScore(line.score),
      from: keyToScreenPos(orig, orientation),
      to: keyToScreenPos(dest, orientation),
    });
  }

  if (entries.length === 0) return [];

  const dests = new Map<Key, Set<number>>();
  const addSlot = (orig: Key, dest: Key) => {
    const from = keyToScreenPos(orig, orientation);
    const to = keyToScreenPos(dest, orientation);
    const set = dests.get(dest) ?? new Set<number>();
    set.add(moveAngleSlot(from, to));
    dests.set(dest, set);
  };
  for (const s of extraShapes) {
    if (s.dest) addSlot(s.orig, s.dest);
  }
  for (const e of entries) {
    addSlot(e.orig, e.dest);
  }

  // Place pills best-to-worst so higher-ranked lines keep priority on ideal arrow coordinates.
  const placed: PlacedPill[] = [];
  const shapesBestFirst: DrawShape[] = [];

  for (const entry of entries) {
    const slots = dests.get(entry.dest);
    const [lx, ly] = estimateLabelPos(entry.from, entry.to, slots);
    const pillW = Math.min(0.72, Math.max(0.38, entry.scoreText.length * 0.1 + 0.16));
    const pillH = 0.24;

    let offsetX = 0;
    let offsetY = 0;

    if (collides(lx, ly, pillW, pillH, placed)) {
      const dx = entry.to[0] - entry.from[0];
      const dy = entry.to[1] - entry.from[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;

      const candidates: [number, number][] = [
        [-0.3 * ux, -0.3 * uy],
        [-0.56 * ux, -0.56 * uy],
        [0.28 * px, 0.28 * py],
        [-0.28 * px, -0.28 * py],
        [-0.82 * ux, -0.82 * uy],
        [0.34 * px - 0.24 * ux, 0.34 * py - 0.24 * uy],
        [-0.34 * px - 0.24 * ux, -0.34 * py - 0.24 * uy],
      ];

      let resolved = false;
      let fallback: { ox: number; oy: number; dist: number } | null = null;

      for (const [ox, oy] of candidates) {
        const cx = lx + ox;
        const cy = ly + oy;
        if (cx < -3.65 || cx > 3.65 || cy < -3.65 || cy > 3.65) continue;
        if (!collides(cx, cy, pillW, pillH, placed)) {
          offsetX = ox;
          offsetY = oy;
          resolved = true;
          break;
        }
        const d = minClearance(cx, cy, placed);
        if (!fallback || d > fallback.dist) {
          fallback = { ox, oy, dist: d };
        }
      }

      if (!resolved && fallback) {
        offsetX = fallback.ox;
        offsetY = fallback.oy;
      }
    }

    placed.push({ x: lx + offsetX, y: ly + offsetY, w: pillW, h: pillH });

    const dxSvg = Math.round(offsetX * 100);
    const dySvg = Math.round(offsetY * 100);
    shapesBestFirst.push({
      orig: entry.orig,
      dest: entry.dest,
      brush: entry.brush,
      modifiers: { lineWidth: BRUSH_STYLE[entry.brush].lineWidth },
      customSvg: {
        center: "label",
        html: buildPillSvg(entry.scoreText, entry.brush, dxSvg, dySvg),
      },
    });
  }

  // Draw worst-to-best so Line 1 paints on top.
  return shapesBestFirst.reverse();
}
