// SPDX-License-Identifier: AGPL-3.0-or-later

import { MOVE_CLASSES, type MoveClass } from "@kingside/chess-core";
import { pgnHash, type SavedGame, type SavedReview } from "@/lib/local-db";

export type Side = "white" | "black";

export interface InsightRow {
  r: SavedReview;
  side: Side;
}

export interface TrendPoint {
  id: string;
  acc: number;
  label: string;
  date: string | null;
}

export interface OpeningAggregate {
  name: string;
  eco: string | null;
  games: number;
  score: number | null;
  accuracy: number | null;
}

export function mean(xs: readonly (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function rowScore(row: InsightRow): number | null {
  const { result } = row.r;
  if (result === "1/2-1/2") return 0.5;
  if (result === "1-0") return row.side === "white" ? 1 : 0;
  if (result === "0-1") return row.side === "black" ? 1 : 0;
  return null;
}

/** Resolves which side of each review belongs to the local player via `r.me` or `myNames`. */
export function resolveInsightRows(
  reviews: readonly SavedReview[],
  myNames: readonly string[],
): InsightRow[] {
  const names = myNames.map((n) => n.toLowerCase());
  return reviews.flatMap((r): InsightRow[] => {
    const me =
      r.me ??
      (names.includes(r.white.toLowerCase())
        ? "white"
        : names.includes(r.black.toLowerCase())
          ? "black"
          : null);
    return me ? [{ r, side: me }] : [];
  });
}

/** Builds a lookup map of `gameHash -> SavedGame` for launching /review from Insights trend points. */
export function buildGameByHashMap(games: readonly SavedGame[]): Map<string, SavedGame> {
  const map = new Map<string, SavedGame>();
  for (const g of games) {
    const computed = pgnHash(g.pgn);
    for (const key of g.hash ? [g.hash, computed] : [computed]) {
      const existing = map.get(key);
      if (!existing || g.playedAt > existing.playedAt) {
        map.set(key, g);
      }
    }
  }
  return map;
}

/** Extracts chronological (oldest-first) accuracy or precision trend points from newest-first InsightRows. */
export function buildTrendPoints(
  rows: readonly InsightRow[],
  metric: "accuracy" | "precision" = "accuracy",
): TrendPoint[] {
  return rows
    .map((x) => {
      const val =
        metric === "precision" ? (x.r.precision?.[x.side] ?? x.r.accuracy[x.side]) : x.r.accuracy[x.side];
      return {
        id: x.r.gameHash,
        acc: val,
        label: `${x.r.white} – ${x.r.black}`,
        date: x.r.date,
      };
    })
    .filter((p): p is TrendPoint => p.acc !== null && Number.isFinite(p.acc))
    .reverse();
}

/** Aggregates openings by name, preserving representative ECO code, score %, and mean accuracy. */
export function aggregateOpenings(
  rows: readonly InsightRow[],
  unknownLabel: string,
  limit = 10,
): OpeningAggregate[] {
  const openings = new Map<string, InsightRow[]>();
  for (const x of rows) {
    const key = x.r.opening ?? unknownLabel;
    const list = openings.get(key);
    if (list) list.push(x);
    else openings.set(key, [x]);
  }
  return [...openings.entries()]
    .map(([name, list]) => {
      const sc = list.map(rowScore).filter((s): s is number => s !== null);
      const eco = list.find((x) => x.r.eco && x.r.eco !== "?")?.r.eco ?? null;
      return {
        name,
        eco,
        games: list.length,
        score: sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length) * 100 : null,
        accuracy: mean(list.map((x) => x.r.accuracy[x.side])),
      };
    })
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Sums move classification counts across all InsightRows. */
export function aggregateMoveCounts(rows: readonly InsightRow[]): {
  counts: Record<MoveClass, number>;
  totalMoves: number;
} {
  const counts = Object.fromEntries(MOVE_CLASSES.map((c) => [c, 0])) as Record<MoveClass, number>;
  for (const x of rows) {
    for (const c of MOVE_CLASSES) {
      counts[c] += x.r.counts[x.side][c] ?? 0;
    }
  }
  const totalMoves = MOVE_CLASSES.reduce((a, c) => a + counts[c], 0);
  return { counts, totalMoves };
}
