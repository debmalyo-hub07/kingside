// SPDX-License-Identifier: AGPL-3.0-or-later
// Lichess opening explorer, Syzygy tablebase and cloud-eval clients (data from lichess.org).
// Explorer: https://lichess.org/api#tag/Opening-Explorer — needs a personal API token (LICHESS_TOKEN, no scopes).
// Tablebase: https://lichess.org/api#tag/Tablebase — public.
// Cloud eval: https://lichess.org/api#tag/Analysis — public; stored evaluations of popular positions.
// Requests are serialized (one at a time) and a 429 pauses calls for a minute, as Lichess asks.

import { z } from "zod";

export class LichessDataError extends Error {
  constructor(
    readonly code: "explorer_unavailable" | "upstream_unavailable" | "upstream_rate_limited",
    readonly status: 502 | 503,
  ) {
    super(code);
  }
}

const TIMEOUT_MS = 10_000;

export class DomainQueue {
  private queue: Promise<unknown> = Promise.resolve();
  private pausedUntil = 0;

  constructor(readonly name: string) {}

  /** Runs requests for this domain strictly one after another. */
  serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => task());
    this.queue = run.catch(() => undefined);
    return run;
  }

  isPaused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  pause(durationMs = 60_000): void {
    this.pausedUntil = Date.now() + durationMs;
  }

  reset(): void {
    this.queue = Promise.resolve();
    this.pausedUntil = 0;
  }
}

export const explorerQueue = new DomainQueue("explorer.lichess.ovh");
export const tablebaseQueue = new DomainQueue("tablebase.lichess.ovh");
export const evalQueue = new DomainQueue("lichess.org/api/cloud-eval");

/** Set when Lichess rejects our token, so we stop sending requests that cannot succeed. */
let tokenRejected = false;

/** True when a token is configured and Lichess has not rejected it. */
export function explorerConfigured(): boolean {
  return !!process.env.LICHESS_TOKEN?.trim() && !tokenRejected;
}

export function resetLichessState(): void {
  tokenRejected = false;
  explorerQueue.reset();
  tablebaseQueue.reset();
  evalQueue.reset();
}

function userAgent(): string {
  const contact = process.env.API_CONTACT?.trim();
  return `Kingside/0.1 (free open-source chess analysis${contact ? `; contact: ${contact}` : ""})`;
}

async function getJson(
  url: URL,
  queue: DomainQueue,
  token?: string,
  notFoundIsNull = false,
): Promise<unknown> {
  if (queue.isPaused()) throw new LichessDataError("upstream_rate_limited", 503);
  return queue.serial(async () => {
    if (queue.isPaused()) throw new LichessDataError("upstream_rate_limited", 503);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new LichessDataError("upstream_unavailable", 502);
    }
    if (res.status === 429) {
      queue.pause(60_000);
      throw new LichessDataError("upstream_rate_limited", 503);
    }
    if (res.status === 401 || res.status === 403) {
      if (token) {
        tokenRejected = true;
        throw new LichessDataError("explorer_unavailable", 503);
      }
      throw new LichessDataError("upstream_unavailable", 502);
    }
    if (res.status === 404 && notFoundIsNull) return null;
    if (!res.ok) throw new LichessDataError("upstream_unavailable", 502);
    try {
      return await res.json();
    } catch {
      throw new LichessDataError("upstream_unavailable", 502);
    }
  });
}

// ---------- Opening explorer ----------

export type ExplorerDb = "masters" | "lichess";

const count = z.number().int().nonnegative();
const player = z.object({ name: z.string().max(100), rating: z.number().int().nullable().optional() });

const explorerSchema = z.object({
  opening: z
    .object({ eco: z.string().max(5), name: z.string().max(200) })
    .nullable()
    .optional(),
  white: count,
  draws: count,
  black: count,
  moves: z
    .array(
      z.object({
        uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
        san: z.string().max(10),
        averageRating: z.number().nullable().optional(),
        white: count,
        draws: count,
        black: count,
      }),
    )
    .max(64),
  topGames: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9]{8}$/),
        uci: z.string().max(5).optional(),
        winner: z.enum(["white", "black"]).nullable().optional(),
        white: player,
        black: player,
        year: z.number().int().nullable().optional(),
      }),
    )
    .max(15)
    .optional()
    .default([]),
});

export interface ExplorerResult {
  db: ExplorerDb;
  opening: { eco: string; name: string } | null;
  total: { white: number; draws: number; black: number };
  moves: {
    uci: string;
    san: string;
    averageRating: number | null;
    white: number;
    draws: number;
    black: number;
  }[];
  topGames: {
    id: string;
    url: string;
    uci: string | null;
    winner: "white" | "black" | null;
    white: { name: string; rating: number | null };
    black: { name: string; rating: number | null };
    year: number | null;
  }[];
}

export async function fetchExplorer(db: ExplorerDb, fen: string): Promise<ExplorerResult> {
  const token = process.env.LICHESS_TOKEN?.trim();
  if (!token || !explorerConfigured()) throw new LichessDataError("explorer_unavailable", 503);
  const url = new URL(`https://explorer.lichess.ovh/${db}`);
  url.searchParams.set("fen", fen);
  url.searchParams.set("moves", "12");
  if (db === "masters") {
    url.searchParams.set("topGames", "5");
  } else {
    url.searchParams.set("speeds", "blitz,rapid,classical");
    url.searchParams.set("ratings", "1600,1800,2000,2200,2500");
    url.searchParams.set("topGames", "0");
    url.searchParams.set("recentGames", "0");
  }
  const parsed = explorerSchema.safeParse(await getJson(url, explorerQueue, token));
  if (!parsed.success) throw new LichessDataError("upstream_unavailable", 502);
  const d = parsed.data;
  return {
    db,
    opening: d.opening ?? null,
    total: { white: d.white, draws: d.draws, black: d.black },
    moves: d.moves.map((m) => ({
      uci: m.uci,
      san: m.san,
      averageRating: m.averageRating ?? null,
      white: m.white,
      draws: m.draws,
      black: m.black,
    })),
    topGames: d.topGames.map((g) => ({
      id: g.id,
      url: `https://lichess.org/${g.id}`,
      uci: g.uci ?? null,
      winner: g.winner ?? null,
      white: { name: g.white.name, rating: g.white.rating ?? null },
      black: { name: g.black.name, rating: g.black.rating ?? null },
      year: g.year ?? null,
    })),
  };
}

// ---------- Tablebase ----------

const CATEGORIES = [
  "win",
  "unknown",
  "syzygy-win",
  "maybe-win",
  "cursed-win",
  "draw",
  "blessed-loss",
  "maybe-loss",
  "syzygy-loss",
  "loss",
] as const;
export type TbCategory = (typeof CATEGORIES)[number];

const tbCommon = {
  category: z.enum(CATEGORIES),
  dtz: z.number().int().nullable().optional(),
  dtm: z.number().int().nullable().optional(),
  checkmate: z.boolean().optional(),
  stalemate: z.boolean().optional(),
  insufficient_material: z.boolean().optional(),
};

const tablebaseSchema = z.object({
  ...tbCommon,
  moves: z
    .array(
      z.object({
        ...tbCommon,
        uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
        san: z.string().max(10),
        zeroing: z.boolean().optional(),
      }),
    )
    .max(256),
});

export interface TablebaseMove {
  uci: string;
  san: string;
  /** From the point of view of the side to move AFTER this move (Lichess convention). */
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface TablebaseResult {
  /** From the point of view of the side to move. */
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  moves: TablebaseMove[];
}

export async function fetchTablebase(fen: string): Promise<TablebaseResult> {
  const url = new URL("https://tablebase.lichess.ovh/standard");
  url.searchParams.set("fen", fen);
  const parsed = tablebaseSchema.safeParse(await getJson(url, tablebaseQueue));
  if (!parsed.success) throw new LichessDataError("upstream_unavailable", 502);
  const d = parsed.data;
  return {
    category: d.category,
    dtz: d.dtz ?? null,
    dtm: d.dtm ?? null,
    checkmate: d.checkmate ?? false,
    stalemate: d.stalemate ?? false,
    insufficientMaterial: d.insufficient_material ?? false,
    moves: d.moves.map((m) => ({
      uci: m.uci,
      san: m.san,
      category: m.category,
      dtz: m.dtz ?? null,
      dtm: m.dtm ?? null,
      zeroing: m.zeroing ?? false,
      checkmate: m.checkmate ?? false,
      stalemate: m.stalemate ?? false,
    })),
  };
}

// ---------- Cloud eval ----------

const cloudSchema = z.object({
  depth: z.number().int().nonnegative(),
  knodes: z.number().nonnegative(),
  pvs: z
    .array(
      z.object({
        moves: z.string().max(400),
        cp: z.number().int().optional(),
        mate: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(5),
});

export interface CloudEval {
  depth: number;
  knodes: number;
  /** Lines best first. Scores are White POV (Lichess cloud evals are White POV). */
  pvs: { moves: string[]; cp?: number; mate?: number }[];
}

/** Stored evaluation of `fen` from the Lichess cloud, or null when the position is not stored. */
export async function fetchCloudEval(fen: string, multiPv: number): Promise<CloudEval | null> {
  const url = new URL("https://lichess.org/api/cloud-eval");
  url.searchParams.set("fen", fen);
  url.searchParams.set("multiPv", String(multiPv));
  const raw = await getJson(url, evalQueue, undefined, true);
  if (raw === null) return null;
  const parsed = cloudSchema.safeParse(raw);
  if (!parsed.success) throw new LichessDataError("upstream_unavailable", 502);
  return {
    depth: parsed.data.depth,
    knodes: parsed.data.knodes,
    pvs: parsed.data.pvs.map((p) => ({
      moves: p.moves.split(" ").filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)),
      ...(p.cp !== undefined ? { cp: p.cp } : {}),
      ...(p.mate !== undefined ? { mate: p.mate } : {}),
    })),
  };
}
