// SPDX-License-Identifier: AGPL-3.0-or-later
// Puzzle API client, local profile storage and theme ids.
"use client";

import { GLICKO_DEFAULT, type GlickoRating, glicko2Update } from "@kingside/chess-core";
import { apiGet } from "@/lib/api";
import { getDb, type PuzzleAttempt, type PuzzleProfile, withTimeout } from "@/lib/local-db";

export interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  ratingDev: number;
  themes: string[];
  openingTags: string[];
  gameUrl: string;
}

export function fetchNextPuzzle(
  rating: number,
  theme: string | null,
  exclude: string[],
): Promise<{ puzzle: Puzzle }> {
  const params = new URLSearchParams({ rating: String(Math.round(Math.min(Math.max(rating, 400), 3500))) });
  if (theme) params.set("theme", theme);
  if (exclude.length) params.set("exclude", exclude.slice(-60).join(","));
  return apiGet(`/api/puzzles/next?${params}`);
}

export function fetchDailyPuzzle(): Promise<{ date: string; puzzle: Puzzle }> {
  return apiGet("/api/puzzles/daily");
}

const DEFAULT_PROFILE: PuzzleProfile = {
  id: "me",
  ...GLICKO_DEFAULT,
  solved: 0,
  failed: 0,
  bestStreak: 0,
  bestTimed: 0,
};

/** Memory fallback when IndexedDB is unavailable. */
let memoryProfile: PuzzleProfile = { ...DEFAULT_PROFILE };

export async function loadProfile(): Promise<PuzzleProfile> {
  try {
    const stored = await withTimeout(
      getDb()?.puzzleProfile.get("me") ?? Promise.resolve(undefined),
      2000,
      undefined,
    );
    return stored ?? memoryProfile;
  } catch {
    return memoryProfile;
  }
}

export async function saveProfile(profile: PuzzleProfile): Promise<void> {
  memoryProfile = profile;
  try {
    await getDb()?.puzzleProfile.put(profile);
  } catch {
    // best-effort
  }
}

export async function recordAttempt(attempt: Omit<PuzzleAttempt, "id" | "at">): Promise<void> {
  try {
    await getDb()?.puzzleAttempts.add({ ...attempt, at: Date.now() });
  } catch {
    // best-effort
  }
}

/** Rated result: Glicko-2 update against the puzzle's own rating. */
export function ratePuzzle(profile: PuzzleProfile, puzzle: Puzzle, solved: boolean): PuzzleProfile {
  const before: GlickoRating = { rating: profile.rating, rd: profile.rd, vol: profile.vol };
  const after = glicko2Update(before, [
    { rating: puzzle.rating, rd: puzzle.ratingDev, score: solved ? 1 : 0 },
  ]);
  return {
    ...profile,
    ...after,
    solved: profile.solved + (solved ? 1 : 0),
    failed: profile.failed + (solved ? 0 : 1),
  };
}

/** Theme filter options (Lichess puzzle theme tags, CC0 data). Labels: messages puzzles.themes.<id>. */
export const PUZZLE_THEMES: string[] = [
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "hangingPiece",
  "trappedPiece",
  "sacrifice",
  "deflection",
  "attraction",
  "clearance",
  "interference",
  "intermezzo",
  "xRayAttack",
  "quietMove",
  "defensiveMove",
  "zugzwang",
  "backRankMate",
  "smotheredMate",
  "promotion",
  "kingsideAttack",
  "opening",
  "middlegame",
  "endgame",
  "rookEndgame",
  "pawnEndgame",
  "short",
  "long",
  "veryLong",
];

/** Readable fallback for theme tags without a translation ("rookEndgame" → "Rook endgame"). */
export function prettyTheme(id: string): string {
  const words = id.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
