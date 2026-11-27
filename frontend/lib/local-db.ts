// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser-local database (IndexedDB via Dexie). Holds only this device's data; never sent anywhere.
"use client";

import type { EngineLine, MoveClass } from "@kingside/chess-core";
import Dexie, { type EntityTable } from "dexie";

export interface CachedEval {
  /** `${epd}|${engine}` — one entry per position and engine version, deepest result kept. */
  key: string;
  depth: number;
  multipv: number;
  lines: EngineLine[];
  savedAt: number;
}

/** Single row (id "me") with this device's puzzle rating and records. */
export interface PuzzleProfile {
  id: "me";
  rating: number;
  rd: number;
  vol: number;
  solved: number;
  failed: number;
  bestStreak: number;
  bestTimed: number;
}

export interface PuzzleAttempt {
  id?: number;
  puzzleId: string;
  mode: "rated" | "streak" | "timed" | "daily";
  solved: boolean;
  /** Rating after the attempt (rated mode). */
  rating?: number;
  at: number;
}

export interface DailyResult {
  /** UTC date YYYY-MM-DD. */
  date: string;
  puzzleId: string;
  solved: boolean;
  mistakes: number;
}

/** A finished game kept on this device (local library). */
export interface SavedGame {
  id?: number;
  pgn: string;
  white: string;
  black: string;
  result: string;
  source: "bot" | "analysis" | "import" | "review" | "shared";
  botId?: string;
  playedAt: number;
  /** Opening name, when known. */
  opening?: string;
  /** Hash of the move text; prevents saving the same game twice. */
  hash?: string;
}

/** Summary of a finished review (for insights). One per game (same moves = same `gameHash`). */
export interface SavedReview {
  gameHash: string;
  white: string;
  black: string;
  whiteRating: number | null;
  blackRating: number | null;
  result: string;
  /** Which side is this device's player, when known (imported by username or a remembered name). */
  me: "white" | "black" | null;
  opening: string | null;
  eco: string | null;
  timeClass: string | null;
  /** Game date (YYYY-MM-DD) when known. */
  date: string | null;
  reviewedAt: number;
  accuracy: { white: number | null; black: number | null };
  precision?: { white: number | null; black: number | null };
  acpl: { white: number | null; black: number | null };
  phaseAccuracy: {
    white: Record<"opening" | "middlegame" | "endgame", number | null>;
    black: Record<"opening" | "middlegame" | "endgame", number | null>;
  };
  counts: { white: Record<string, number>; black: Record<string, number> };
  moves: number;
  classes?: MoveClass[];
  /** Full PGN of the reviewed game (for instant reload/library/insights hydration). */
  pgn?: string;
  /** White win % series (0..100, start first) as a fallback when `db.evals` was pruned. */
  whiteWin?: number[];
}

/** A mistake from a reviewed game, practiced with spaced repetition (Leitner boxes). */
export interface Drill {
  /** `${epd}|${playedUci}` */
  id: string;
  fen: string;
  color: "white" | "black";
  playedSan: string;
  playedUci: string;
  bestSan: string;
  bestUci: string;
  classification: string;
  /** Engine lines of the position (best first), to judge other answers without an engine. */
  lines: EngineLine[];
  gameHash: string;
  ply: number;
  white: string;
  black: string;
  opening: string | null;
  createdAt: number;
  /** 0 = new/failed … 5 = learned. */
  box: number;
  /** Next time it is due (ms). */
  due: number;
  attempts: number;
  solved: number;
}

/** Progress on a practice position (id from practice-positions.ts). */
export interface PracticeResult {
  id: string;
  solvedAt: number;
  attempts: number;
}

class KingsideDb extends Dexie {
  evals!: EntityTable<CachedEval, "key">;
  puzzleProfile!: EntityTable<PuzzleProfile, "id">;
  puzzleAttempts!: EntityTable<PuzzleAttempt, "id">;
  daily!: EntityTable<DailyResult, "date">;
  games!: EntityTable<SavedGame, "id">;
  reviews!: EntityTable<SavedReview, "gameHash">;
  drills!: EntityTable<Drill, "id">;
  practice!: EntityTable<PracticeResult, "id">;

  constructor() {
    super("kingside");
    this.version(1).stores({ evals: "key, savedAt" });
    this.version(2).stores({
      evals: "key, savedAt",
      puzzleProfile: "id",
      puzzleAttempts: "++id, puzzleId, at",
      daily: "date",
    });
    this.version(3).stores({
      evals: "key, savedAt",
      puzzleProfile: "id",
      puzzleAttempts: "++id, puzzleId, at",
      daily: "date",
      games: "++id, playedAt, source",
    });
    this.version(4).stores({
      evals: "key, savedAt",
      puzzleProfile: "id",
      puzzleAttempts: "++id, puzzleId, at",
      daily: "date",
      games: "++id, playedAt, source, hash",
    });
    this.version(5).stores({
      evals: "key, savedAt",
      puzzleProfile: "id",
      puzzleAttempts: "++id, puzzleId, at",
      daily: "date",
      games: "++id, playedAt, source, hash",
      reviews: "gameHash, reviewedAt",
      drills: "id, due, gameHash",
      practice: "id",
    });
    this.version(6).stores({
      evals: "key, savedAt",
      puzzleProfile: "id",
      puzzleAttempts: "++id, puzzleId, at",
      daily: "date",
      games: "++id, playedAt, source, hash",
      reviews: "gameHash, reviewedAt",
      drills: "id, due, gameHash",
      practice: "id",
    });
  }
}

let db: KingsideDb | null = null;

/** null when IndexedDB is unavailable (private mode, blocked storage) — callers just skip caching. */
export function getDb(): KingsideDb | null {
  if (typeof indexedDB === "undefined") return null;
  try {
    db ??= new KingsideDb();
    return db;
  } catch {
    return null;
  }
}

const MAX_ENTRIES = 50_000;

/**
 * Resolves with `fallback` if IndexedDB does not answer in time (e.g. an upgrade blocked by another tab),
 * so local storage can never freeze the UI.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export function evalKey(fen: string, engine: string): string {
  return `${fen.split(" ").slice(0, 4).join(" ")}|${engine}`;
}

/** Cached lines at least as deep/wide as requested, else null. */
export async function getCachedEval(
  key: string,
  depth: number,
  multipv: number,
): Promise<EngineLine[] | null> {
  try {
    const hit = await withTimeout(getDb()?.evals.get(key) ?? Promise.resolve(undefined), 1500, undefined);
    if (!hit || hit.depth < depth || hit.multipv < multipv || hit.lines.length < multipv) return null;
    const sliced = hit.lines.slice(0, multipv);
    if (!key.endsWith("|nodes") && sliced.some((l) => l.depth > 0 && l.depth < depth)) return null;
    return sliced;
  } catch {
    return null;
  }
}

export async function getCachedEvalsBatch(keys: readonly string[]): Promise<(CachedEval | undefined)[]> {
  const d = getDb();
  if (!d || keys.length === 0) return [];
  try {
    return await withTimeout(d.evals.bulkGet([...keys]), 2000, []);
  } catch {
    return [];
  }
}

export async function putCachedEval(
  key: string,
  depth: number,
  multipv: number,
  lines: EngineLine[],
): Promise<void> {
  const d = getDb();
  if (!d || lines.length === 0) return;
  const storedLines = lines.slice(0, Math.max(1, multipv));
  const actualMultiPv = storedLines.length;
  const isNodeBudget = key.endsWith("|nodes");
  const minPositiveLineDepth = storedLines.reduce(
    (min, l) => (l.depth > 0 ? Math.min(min, l.depth) : min),
    depth,
  );
  const effectiveDepth = isNodeBudget ? depth : Math.min(depth, minPositiveLineDepth);
  try {
    const old = await d.evals.get(key);
    const oldValid = old && old.lines.length >= old.multipv;
    if (
      oldValid &&
      (old.depth > effectiveDepth || (old.depth === effectiveDepth && old.multipv >= actualMultiPv))
    ) {
      return;
    }
    await d.evals.put({
      key,
      depth: effectiveDepth,
      multipv: actualMultiPv,
      lines: storedLines,
      savedAt: Date.now(),
    });
    if (Math.random() < 0.01 && (await d.evals.count()) > MAX_ENTRIES) {
      const oldest = await d.evals.orderBy("savedAt").limit(5_000).primaryKeys();
      await d.evals.bulkDelete(oldest);
    }
  } catch {
    // Storage full or blocked: caching is best-effort.
  }
}

const IDENTITY_HEADERS = new Set([
  "white",
  "black",
  "date",
  "utcdate",
  "utctime",
  "time",
  "starttime",
  "endtime",
  "site",
  "link",
  "event",
  "round",
  "result",
  "fen",
  "setup",
  "timecontrol",
  "whiteelo",
  "blackelo",
]);

function extractIdentityHeaders(pgn: string): string {
  const headers: [string, string][] = [];
  const re = /^\s*\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  for (const match of pgn.matchAll(re)) {
    const key = (match[1] ?? "").toLowerCase();
    const val = (match[2] ?? "").trim();
    if (!IDENTITY_HEADERS.has(key)) continue;
    if (!val || val === "?" || val === "????.??.??") continue;
    headers.push([key, val]);
  }
  headers.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].localeCompare(b[1])));
  return headers.map(([k, v]) => `${k}=${v}`).join("\n");
}

/** 64-bit FNV-1a hash of identifying PGN headers + normalized move text, as 16 hex chars. */
export function pgnHash(pgn: string): string {
  const headerPart = extractIdentityHeaders(pgn);
  const moves = pgn
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const payload = headerPart ? `${headerPart}\n---\n${moves}` : moves;
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < payload.length; i++) {
    h ^= BigInt(payload.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

/** Saves a game to the local library; returns the existing id if the same moves were saved before. */
export async function saveGame(game: Omit<SavedGame, "id" | "hash">): Promise<number | undefined> {
  const d = getDb();
  if (!d) return undefined;
  const hash = pgnHash(game.pgn);
  try {
    return await withTimeout(
      (async () => {
        const existing = await d.games.where("hash").equals(hash).first();
        if (existing?.id !== undefined) return existing.id;
        return d.games.add({ ...game, hash });
      })(),
      2000,
      undefined,
    );
  } catch {
    return undefined;
  }
}

export async function getGameByHash(hash: string): Promise<SavedGame | undefined> {
  const d = getDb();
  if (!d) return undefined;
  try {
    return await withTimeout(d.games.where("hash").equals(hash).first(), 2000, undefined);
  } catch {
    return undefined;
  }
}

export async function listGames(): Promise<SavedGame[]> {
  try {
    return await withTimeout(
      getDb()?.games.orderBy("playedAt").reverse().toArray() ?? Promise.resolve([]),
      3000,
      [],
    );
  } catch {
    return [];
  }
}

export async function deleteGames(ids: number[]): Promise<void> {
  try {
    await getDb()?.games.bulkDelete(ids);
  } catch {
    // best-effort
  }
}

// ---------- reviews, drills, practice ----------

export async function saveReview(review: SavedReview): Promise<void> {
  try {
    await withTimeout(getDb()?.reviews.put(review) ?? Promise.resolve(undefined), 2000, undefined);
  } catch {
    // best-effort
  }
}

export async function getReview(gameHash: string): Promise<SavedReview | undefined> {
  try {
    return await withTimeout(getDb()?.reviews.get(gameHash) ?? Promise.resolve(undefined), 2000, undefined);
  } catch {
    return undefined;
  }
}

export async function listReviews(): Promise<SavedReview[]> {
  try {
    return await withTimeout(
      getDb()?.reviews.orderBy("reviewedAt").reverse().toArray() ?? Promise.resolve([]),
      3000,
      [],
    );
  } catch {
    return [];
  }
}

/** Adds new drills; existing ones (same position + move) keep their progress. */
export async function addDrills(drills: Drill[]): Promise<void> {
  const d = getDb();
  if (!d || drills.length === 0) return;
  try {
    await withTimeout(
      d.transaction("rw", d.drills, async () => {
        const existing = new Set(
          await d.drills
            .where("id")
            .anyOf(drills.map((x) => x.id))
            .primaryKeys(),
        );
        await d.drills.bulkAdd(drills.filter((x) => !existing.has(x.id)));
      }),
      3000,
      undefined,
    );
  } catch {
    // best-effort
  }
}

export async function listDrills(): Promise<Drill[]> {
  try {
    return await withTimeout(getDb()?.drills.orderBy("due").toArray() ?? Promise.resolve([]), 3000, []);
  } catch {
    return [];
  }
}

/** Leitner intervals in days per box after a correct answer. */
const DRILL_DAYS = [0, 1, 3, 7, 16, 35];

/** Records an answer: correct moves the drill up a box (due later), wrong sends it back to box 0. */
export async function answerDrill(id: string, correct: boolean, now = Date.now()): Promise<Drill | null> {
  const d = getDb();
  if (!d) return null;
  try {
    const drill = await d.drills.get(id);
    if (!drill) return null;
    const box = correct ? Math.min(drill.box + 1, DRILL_DAYS.length - 1) : 0;
    const next: Drill = {
      ...drill,
      box,
      due: now + (correct ? (DRILL_DAYS[box] ?? 1) : 0) * 86_400_000 + (correct ? 0 : 10 * 60_000),
      attempts: drill.attempts + 1,
      solved: drill.solved + (correct ? 1 : 0),
    };
    await d.drills.put(next);
    return next;
  } catch {
    return null;
  }
}

export async function deleteDrills(ids: string[]): Promise<void> {
  try {
    await getDb()?.drills.bulkDelete(ids);
  } catch {
    // best-effort
  }
}

export async function practiceResults(): Promise<Map<string, PracticeResult>> {
  try {
    const rows = await withTimeout(getDb()?.practice.toArray() ?? Promise.resolve([]), 3000, []);
    return new Map(rows.map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

export async function markPractice(id: string, solved: boolean): Promise<void> {
  const d = getDb();
  if (!d) return;
  try {
    const old = await d.practice.get(id);
    await d.practice.put({
      id,
      solvedAt: solved ? Date.now() : (old?.solvedAt ?? 0),
      attempts: (old?.attempts ?? 0) + 1,
    });
  } catch {
    // best-effort
  }
}
