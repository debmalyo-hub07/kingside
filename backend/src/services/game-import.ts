// SPDX-License-Identifier: AGPL-3.0-or-later
// Fetches a user's recent public games from Lichess and Chess.com and normalizes them.
// Lichess: https://lichess.org/api#tag/Games/operation/apiGamesUser
// Chess.com Published-Data API: read-only, serial requests, User-Agent with contact info, ETag/304 + 12h cache.

import { z } from "zod";
import { DomainQueue } from "./lichess-data";
import { TtlCache } from "./ttl-cache";

export type GameSource = "lichess" | "chesscom";

export interface ImportedGame {
  id: string;
  source: GameSource;
  url: string;
  white: { name: string; rating: number | null };
  black: { name: string; rating: number | null };
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  timeClass: string;
  /** Unix ms. */
  playedAt: number;
  opening: string | null;
  pgn: string;
}

export class UpstreamError extends Error {
  constructor(
    readonly code: "user_not_found" | "upstream_unavailable" | "upstream_rate_limited",
    readonly status: 404 | 502 | 503,
  ) {
    super(code);
  }
}

const MAX_PGN = 100_000;
const TIMEOUT_MS = 15_000;
const CHESSCOM_CACHE_TTL_MS = 12 * 60 * 60_000;

interface CachedJson {
  etag: string | null;
  body: unknown;
}

const chesscomQueue = new DomainQueue("api.chess.com");
const chesscomCache = new TtlCache<CachedJson>(CHESSCOM_CACHE_TTL_MS, 1_000);

export function resetGameImportCache(): void {
  chesscomQueue.reset();
  // TtlCache does not expose clear(); overwrite? Add clear() or re-instantiate via clear helper.
  chesscomCache.clear();
}

function userAgent(): string {
  const contact = process.env.API_CONTACT?.trim();
  return `Kingside/0.1 (free open-source chess analysis${contact ? `; contact: ${contact}` : ""})`;
}

async function get(url: string, accept: string, extraHeaders?: Record<string, string>): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: accept, "User-Agent": userAgent(), ...extraHeaders },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("upstream_unavailable", 502);
  }
  if (res.status === 304) return res;
  if (res.status === 404) throw new UpstreamError("user_not_found", 404);
  if (res.status === 429) throw new UpstreamError("upstream_rate_limited", 503);
  if (!res.ok) throw new UpstreamError("upstream_unavailable", 502);
  return res;
}

// ---------- Lichess ----------

const lichessPlayer = z
  .object({
    user: z.object({ name: z.string() }).optional(),
    rating: z.number().optional(),
    aiLevel: z.number().optional(),
  })
  .loose();

const lichessGame = z
  .object({
    id: z.string(),
    variant: z.string(),
    speed: z.string(),
    createdAt: z.number(),
    lastMoveAt: z.number().optional(),
    winner: z.enum(["white", "black"]).optional(),
    status: z.string(),
    players: z.object({ white: lichessPlayer, black: lichessPlayer }),
    opening: z.object({ name: z.string() }).loose().optional(),
    pgn: z.string(),
  })
  .loose();

function lichessName(p: z.infer<typeof lichessPlayer>): string {
  if (p.user?.name) return p.user.name;
  return p.aiLevel ? `Stockfish level ${p.aiLevel}` : "Anonymous";
}

export async function fetchLichessGames(username: string, max: number): Promise<ImportedGame[]> {
  const params = new URLSearchParams({
    max: String(max),
    pgnInJson: "true",
    opening: "true",
    clocks: "true",
    evals: "false",
    perfType: "ultraBullet,bullet,blitz,rapid,classical,correspondence",
  });
  const res = await get(
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`,
    "application/x-ndjson",
  );
  const text = await res.text();
  const games: ImportedGame[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = lichessGame.safeParse(json);
    if (!parsed.success || parsed.data.variant !== "standard" || parsed.data.pgn.length > MAX_PGN) continue;
    const g = parsed.data;
    const draw = !g.winner && g.status !== "started" && g.status !== "created";
    games.push({
      id: `lichess:${g.id}`,
      source: "lichess",
      url: `https://lichess.org/${g.id}`,
      white: { name: lichessName(g.players.white), rating: g.players.white.rating ?? null },
      black: { name: lichessName(g.players.black), rating: g.players.black.rating ?? null },
      result: g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : draw ? "1/2-1/2" : "*",
      timeClass: g.speed,
      playedAt: g.lastMoveAt ?? g.createdAt,
      opening: g.opening?.name ?? null,
      pgn: g.pgn,
    });
  }
  return games;
}

// ---------- Chess.com ----------

const chesscomPlayer = z
  .object({ username: z.string(), rating: z.number().optional(), result: z.string() })
  .loose();
const chesscomGame = z
  .object({
    url: z.string(),
    pgn: z.string().optional(),
    time_class: z.string(),
    rules: z.string(),
    end_time: z.number(),
    white: chesscomPlayer,
    black: chesscomPlayer,
  })
  .loose();
const chesscomArchive = z.object({ games: z.array(z.unknown()) });
const chesscomArchives = z.object({ archives: z.array(z.string()) });

const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

function chesscomOpening(pgn: string): string | null {
  const url = pgn.match(/\[ECOUrl "https:\/\/www\.chess\.com\/openings\/([^"]+)"\]/)?.[1];
  if (!url) return null;
  // Slugs can end with a move list ("...-6.e3-O-O-7.Bd3"); keep only the opening name.
  const name = decodeURIComponent(url)
    .replace(/\.\.\..*$|-\d+\..*$/, "")
    .replace(/-/g, " ")
    .trim();
  return name || null;
}

async function fetchChesscomJson(url: string, useCachedWithoutRevalidation = false): Promise<unknown> {
  const cached = chesscomCache.get(url);
  if (useCachedWithoutRevalidation && cached) {
    return cached.body;
  }

  return chesscomQueue.serial(async () => {
    const insideCached = chesscomCache.get(url);
    if (useCachedWithoutRevalidation && insideCached) {
      return insideCached.body;
    }

    const headers = insideCached?.etag ? { "If-None-Match": insideCached.etag } : undefined;
    const res = await get(url, "application/json", headers);
    if (res.status === 304) {
      if (!insideCached) throw new UpstreamError("upstream_unavailable", 502);
      const nextEtag = res.headers.get("etag") ?? insideCached.etag;
      const refreshed: CachedJson = { etag: nextEtag, body: insideCached.body };
      chesscomCache.set(url, refreshed);
      return insideCached.body;
    }

    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      throw new UpstreamError("upstream_unavailable", 502);
    }
    const etag = res.headers.get("etag");
    chesscomCache.set(url, { etag, body });
    return body;
  });
}

/** Walks monthly archives newest-first, one request at a time, until `max` games are collected. */
export async function fetchChesscomGames(username: string, max: number): Promise<ImportedGame[]> {
  const user = username.toLowerCase();
  const archivesRaw = await fetchChesscomJson(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
  );
  const archivesParsed = chesscomArchives.safeParse(archivesRaw);
  if (!archivesParsed.success) throw new UpstreamError("upstream_unavailable", 502);
  const archives = archivesParsed.data.archives.filter((u) =>
    u.startsWith("https://api.chess.com/pub/player/"),
  );
  const games: ImportedGame[] = [];
  const newestFirst = [...archives].reverse().slice(0, 6);
  for (let i = 0; i < newestFirst.length; i++) {
    const archiveUrl = newestFirst[i] as string;
    // Past months (index > 0) are cached directly for 12h; newest archive validates via ETag / If-None-Match.
    const raw = await fetchChesscomJson(archiveUrl, i > 0);
    const monthlyParsed = chesscomArchive.safeParse(raw);
    if (!monthlyParsed.success) throw new UpstreamError("upstream_unavailable", 502);
    const monthly = monthlyParsed.data.games;
    const parsed = monthly
      .map((g) => chesscomGame.safeParse(g))
      .filter((r) => r.success)
      .map((r) => r.data)
      .filter((g) => g.rules === "chess" && g.pgn && g.pgn.length <= MAX_PGN)
      .sort((a, b) => b.end_time - a.end_time);
    for (const g of parsed) {
      const result =
        g.white.result === "win"
          ? "1-0"
          : g.black.result === "win"
            ? "0-1"
            : DRAW_RESULTS.has(g.white.result)
              ? "1/2-1/2"
              : "*";
      games.push({
        id: `chesscom:${g.url.split("/").pop() ?? g.end_time}`,
        source: "chesscom",
        url: g.url,
        white: { name: g.white.username, rating: g.white.rating ?? null },
        black: { name: g.black.username, rating: g.black.rating ?? null },
        result,
        timeClass: g.time_class,
        playedAt: g.end_time * 1000,
        opening: chesscomOpening(g.pgn ?? ""),
        pgn: g.pgn ?? "",
      });
      if (games.length >= max) return games;
    }
  }
  return games;
}
