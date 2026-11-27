// SPDX-License-Identifier: AGPL-3.0-or-later

import { pgnHash, type SavedGame, type SavedReview } from "@/lib/local-db";

export type SourceFilter = "all" | SavedGame["source"];
export type ResultFilter = "all" | "1-0" | "0-1" | "1/2-1/2";

function cleanTagValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "?" || trimmed === "????.??.??") return null;
  return trimmed;
}

function pgnHeader(pgn: string, tag: string): string | null {
  const re = new RegExp(`^\\s*\\[${tag}\\s+"((?:[^"\\\\]|\\\\.)*)"\\]`, "m");
  const match = re.exec(pgn);
  return cleanTagValue(match?.[1]);
}

/** Builds a lookup map of `gameHash -> SavedReview`, keeping the newest review when duplicates exist. */
export function buildReviewMap(reviews: readonly SavedReview[]): Map<string, SavedReview> {
  const map = new Map<string, SavedReview>();
  for (const r of reviews) {
    const prev = map.get(r.gameHash);
    if (!prev || r.reviewedAt > prev.reviewedAt) {
      map.set(r.gameHash, r);
    }
  }
  return map;
}

/** Matches a SavedGame to its SavedReview via stored `game.hash` or computed `pgnHash(game.pgn)`. */
export function matchGameReview(
  game: Pick<SavedGame, "hash" | "pgn">,
  reviewByHash: ReadonlyMap<string, SavedReview>,
): SavedReview | undefined {
  if (game.hash) {
    const byStored = reviewByHash.get(game.hash);
    if (byStored) return byStored;
  }
  return reviewByHash.get(pgnHash(game.pgn));
}

export interface OpeningBadge {
  eco: string | null;
  name: string | null;
}

/** Extracts structured ECO code and opening name from SavedGame, SavedReview, and PGN headers. */
export function extractOpeningBadge(
  game: Pick<SavedGame, "opening" | "pgn">,
  review?: Pick<SavedReview, "eco" | "opening">,
): OpeningBadge | null {
  const eco = cleanTagValue(review?.eco) ?? pgnHeader(game.pgn, "ECO");
  const name =
    cleanTagValue(game.opening) ?? cleanTagValue(review?.opening) ?? pgnHeader(game.pgn, "Opening");
  if (!eco && !name) return null;
  return { eco, name };
}

/** Filters library games by source, result, and free-text query across players, ECO, or opening. */
export function filterLibraryGames(
  games: readonly SavedGame[],
  opts: { query: string; source: SourceFilter; result: ResultFilter },
  reviewByHash?: ReadonlyMap<string, SavedReview>,
): SavedGame[] {
  const q = opts.query.trim().toLowerCase();
  return games.filter((g) => {
    if (opts.source !== "all" && g.source !== opts.source) return false;
    if (opts.result !== "all" && g.result !== opts.result) return false;
    if (!q) return true;
    const review = reviewByHash ? matchGameReview(g, reviewByHash) : undefined;
    const badge = extractOpeningBadge(g, review);
    const haystack = `${g.white} ${g.black} ${badge?.eco ?? ""} ${badge?.name ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}
