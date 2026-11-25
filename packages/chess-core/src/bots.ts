// SPDX-License-Identifier: AGPL-3.0-or-later
// Bot strength levels and move choice (docs/ALGORITHMS.md §9). Personas are Kingside's own characters.

import { makeSquare } from "chessops/util";
import { positionFromFen } from "./game-tree";
import type { EngineLine } from "./review";
import type { Color } from "./types";

export interface BotLevel {
  /** Target playing strength (Elo-like). */
  elo: number;
  /**
   * "limit": Stockfish UCI_LimitStrength + UCI_Elo (engine supports 1320–3190).
   * "sample": Skill Level + shallow MultiPV search, then our own randomised choice (below 1320).
   * "max": full strength.
   */
  method: "limit" | "sample" | "max";
  skill?: number;
  depth?: number;
  movetimeMs?: number;
  multiPv?: number;
  /** Softmax temperature in centipawns for "sample" (higher = more random). */
  temperatureCp?: number;
  /** Chance to ignore evaluations and pick any of the candidate moves ("sample"). */
  blunderChance?: number;
  /** UCI_Elo actually sent to the engine for "limit" (defaults to `elo`; the engine floor is 1320). */
  engineElo?: number;
  /** "limit": chance per move to play an unguided legal move instead — how bots below 1320 get weaker. */
  randomMoveChance?: number;
  /** Opening book ply limit for human-like repertoire variety (defaults to 10). */
  bookPlies?: number;
}

export interface BotPersona {
  id: string;
  name: string;
  tagline: string;
  /** Avatar colors (own artwork, drawn in the UI). */
  colors: [string, string];
  level: BotLevel;
}

export const BOTS: readonly BotPersona[] = [
  {
    id: "pip",
    name: "Pip",
    tagline: "Just learned how the pieces move.",
    colors: ["#86efac", "#22c55e"],
    level: {
      elo: 400,
      method: "limit",
      engineElo: 1320,
      randomMoveChance: 0.4,
      movetimeMs: 600,
      bookPlies: 4,
    },
  },
  {
    id: "rosa",
    name: "Rosa",
    tagline: "Knows the rules, still hangs a piece now and then.",
    colors: ["#fda4af", "#e11d48"],
    level: {
      elo: 700,
      method: "limit",
      engineElo: 1320,
      randomMoveChance: 0.25,
      movetimeMs: 600,
      bookPlies: 5,
    },
  },
  {
    id: "milo",
    name: "Milo",
    tagline: "Spots simple tactics, misses deeper ones.",
    colors: ["#93c5fd", "#2563eb"],
    level: {
      elo: 1000,
      method: "limit",
      engineElo: 1320,
      randomMoveChance: 0.12,
      movetimeMs: 600,
      bookPlies: 6,
    },
  },
  {
    id: "tara",
    name: "Tara",
    tagline: "Solid club player. Punishes loose pieces.",
    colors: ["#fcd34d", "#d97706"],
    level: { elo: 1320, method: "limit", movetimeMs: 1200, bookPlies: 8 },
  },
  {
    id: "kenji",
    name: "Kenji",
    tagline: "Plans ahead and likes active pieces.",
    colors: ["#c4b5fd", "#7c3aed"],
    level: { elo: 1600, method: "limit", movetimeMs: 1400, bookPlies: 9 },
  },
  {
    id: "amara",
    name: "Amara",
    tagline: "Strong tournament player. Few free gifts.",
    colors: ["#5eead4", "#0d9488"],
    level: { elo: 1900, method: "limit", movetimeMs: 1500, bookPlies: 10 },
  },
  {
    id: "viktor",
    name: "Viktor",
    tagline: "Expert strength. Converts small edges.",
    colors: ["#fdba74", "#ea580c"],
    level: { elo: 2200, method: "limit", movetimeMs: 1600, bookPlies: 10 },
  },
  {
    id: "selene",
    name: "Selene",
    tagline: "Master level. Precise in the endgame.",
    colors: ["#f9a8d4", "#db2777"],
    level: { elo: 2500, method: "limit", movetimeMs: 1800, bookPlies: 12 },
  },
  {
    id: "atlas",
    name: "Atlas",
    tagline: "Grandmaster strength. Good luck.",
    colors: ["#cbd5e1", "#475569"],
    level: { elo: 2800, method: "limit", movetimeMs: 2000, bookPlies: 12 },
  },
  {
    id: "max",
    name: "Kingside Max",
    tagline: "Stockfish 19 at full power. Unbeatable for humans.",
    colors: ["#34d399", "#f5c56b"],
    level: { elo: 3190, method: "max", movetimeMs: 2000, bookPlies: 12 },
  },
];

const MATE_CP = 10_000;

function moverCp(line: EngineLine, mover: Color): number {
  const sign = mover === "white" ? 1 : -1;
  if (line.score.mate !== undefined) {
    const m = line.score.mate * sign;
    // Faster mates are better; being mated sooner is worse.
    return m > 0 ? MATE_CP - m : -MATE_CP - m;
  }
  return line.score.cp * sign;
}

/**
 * Picks a move from the engine's candidate lines for a "sample" level.
 * `random` returns numbers in [0, 1) (Math.random in the app, seeded in tests).
 */
export function pickBotMove(
  lines: readonly EngineLine[],
  mover: Color,
  level: BotLevel,
  random: () => number = Math.random,
): string | undefined {
  const candidates = lines.filter((l) => l.pv[0]);
  if (candidates.length === 0) return undefined;
  if (level.method !== "sample" || candidates.length === 1) return candidates[0]?.pv[0];

  if (random() < (level.blunderChance ?? 0)) {
    return candidates[Math.floor(random() * candidates.length)]?.pv[0];
  }
  const t = Math.max(level.temperatureCp ?? 50, 1);
  const scores = candidates.map((l) => moverCp(l, mover));
  const best = Math.max(...scores);
  const weights = scores.map((s) => Math.exp(Math.max((s - best) / t, -50)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (const [i, w] of weights.entries()) {
    r -= w;
    if (r <= 0) return candidates[i]?.pv[0];
  }
  return candidates[0]?.pv[0];
}

export function botById(id: string): BotPersona | undefined {
  return BOTS.find((b) => b.id === id);
}

/** A uniformly random legal move (UCI), used for the deliberate mistakes of the easiest bots. */
export function randomLegalMove(fen: string, random: () => number = Math.random): string | undefined {
  const pos = positionFromFen(fen);
  const moves: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const promo = pos.board.get(from)?.role === "pawn";
    for (const to of dests) {
      const suffix = promo && (to >= 56 || to < 8) ? "q" : "";
      moves.push(makeSquare(from) + makeSquare(to) + suffix);
    }
  }
  return moves[Math.floor(random() * moves.length)];
}

/**
 * Human-like novice mistake move: avoids aimless king shuffles when non-king moves exist while still
 * making genuine tactical/positional errors.
 */
export function humanLikeMistakeMove(fen: string, random: () => number = Math.random): string | undefined {
  const pos = positionFromFen(fen);
  const preferred: string[] = [];
  const fallback: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const piece = pos.board.get(from);
    const promo = piece?.role === "pawn";
    for (const to of dests) {
      const suffix = promo && (to >= 56 || to < 8) ? "q" : "";
      const uci = makeSquare(from) + makeSquare(to) + suffix;
      if (piece?.role === "king") fallback.push(uci);
      else preferred.push(uci);
    }
  }
  const pool = preferred.length > 0 && random() < 0.85 ? preferred : [...preferred, ...fallback];
  return pool[Math.floor(random() * pool.length)];
}
