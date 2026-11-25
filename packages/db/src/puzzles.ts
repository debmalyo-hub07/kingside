// SPDX-License-Identifier: AGPL-3.0-or-later
// Puzzle queries shared by the backend API and maintenance scripts.
// Filters are built only from validated primitives; operator objects are marked `trusted`
// because the global sanitizeFilter guard would otherwise neutralise them (CLAUDE.md §9).

import mongoose from "mongoose";
import { DailyPuzzle, Puzzle } from "./models";

export interface PuzzleDto {
  id: string;
  fen: string;
  /** UCI. moves[0] is the opponent's move that sets up the puzzle; the solver plays moves[1], [3], … */
  moves: string[];
  rating: number;
  ratingDev: number;
  themes: string[];
  openingTags: string[];
  gameUrl: string;
}

interface PuzzleLean {
  _id: string;
  fen: string;
  moves: string[];
  rating: number;
  ratingDev: number;
  themes?: string[];
  openingTags?: string[];
  gameUrl?: string;
}

const trusted = (q: object) => mongoose.trusted(q) as never;

function toDto(p: PuzzleLean): PuzzleDto {
  return {
    id: p._id,
    fen: p.fen,
    moves: p.moves,
    rating: p.rating,
    ratingDev: p.ratingDev,
    themes: p.themes ?? [],
    openingTags: p.openingTags ?? [],
    gameUrl: p.gameUrl ?? "",
  };
}

export async function getPuzzle(id: string): Promise<PuzzleDto | null> {
  const p = await Puzzle.findById(id).lean<PuzzleLean>();
  return p ? toDto(p) : null;
}

/** Random puzzle near `rating` (widening the window until something matches), optionally of a theme. */
export async function nextPuzzle(opts: {
  rating: number;
  theme?: string;
  exclude?: string[];
}): Promise<PuzzleDto | null> {
  for (const spread of [100, 200, 400, 800, 3000]) {
    const filter: Record<string, unknown> = {
      rating: trusted({ $gte: opts.rating - spread, $lte: opts.rating + spread }),
    };
    if (opts.theme) filter.themes = opts.theme;
    if (opts.exclude?.length) filter._id = trusted({ $nin: opts.exclude });
    const r = Math.random();
    const p =
      (await Puzzle.findOne({ ...filter, rnd: trusted({ $gte: r }) })
        .sort({ rnd: 1 })
        .lean<PuzzleLean>()) ??
      (await Puzzle.findOne({ ...filter, rnd: trusted({ $lt: r }) })
        .sort({ rnd: -1 })
        .lean<PuzzleLean>());
    if (p) return toDto(p);
  }
  return null;
}

/** Stable 32-bit hash of the date string -> [0, 1). */
function dateFraction(date: string): number {
  let h = 2166136261;
  for (const ch of date) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

/** Curated pool for the daily puzzle: very popular, well-tested, mid-range difficulty. */
const DAILY_POOL = {
  popularity: trusted({ $gte: 95 }),
  nbPlays: trusted({ $gte: 2000 }),
  rating: trusted({ $gte: 1400, $lte: 2200 }),
};

/** The puzzle of the day (UTC date, YYYY-MM-DD). Picked deterministically, then stored so it never changes. */
export async function dailyPuzzle(date: string): Promise<PuzzleDto | null> {
  const existing = await DailyPuzzle.findById(date).lean<{ puzzleId: string }>();
  if (existing) return getPuzzle(existing.puzzleId);
  const r = dateFraction(date);
  const pick =
    (await Puzzle.findOne({ ...DAILY_POOL, rnd: trusted({ $gte: r }) })
      .sort({ rnd: 1 })
      .lean<PuzzleLean>()) ?? (await Puzzle.findOne(DAILY_POOL).sort({ rnd: 1 }).lean<PuzzleLean>());
  if (!pick) return null;
  // $setOnInsert: if two requests race, both end up with the first stored choice.
  await DailyPuzzle.updateOne({ _id: date }, { $setOnInsert: { puzzleId: pick._id } }, { upsert: true });
  const stored = await DailyPuzzle.findById(date).lean<{ puzzleId: string }>();
  return stored ? getPuzzle(stored.puzzleId) : toDto(pick);
}

export function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
