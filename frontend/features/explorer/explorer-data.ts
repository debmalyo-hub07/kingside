// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening explorer + tablebase data for the analysis board. Server data comes through our backend
// (cached there); results are also memoized per page so stepping back and forth is instant.
"use client";

import { isTablebasePosition } from "@kingside/chess-core";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { useEffect, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";
import { loadOpenings } from "@/lib/openings";

export type ExplorerDb = "masters" | "lichess";

export interface ExplorerMove {
  uci: string;
  san: string;
  averageRating: number | null;
  white: number;
  draws: number;
  black: number;
}

export interface ExplorerResult {
  db: ExplorerDb;
  opening: { eco: string; name: string } | null;
  total: { white: number; draws: number; black: number };
  moves: ExplorerMove[];
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

export type TbCategory =
  | "win"
  | "unknown"
  | "syzygy-win"
  | "maybe-win"
  | "cursed-win"
  | "draw"
  | "blessed-loss"
  | "maybe-loss"
  | "syzygy-loss"
  | "loss";

export interface TablebaseMove {
  uci: string;
  san: string;
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface TablebaseResult {
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  moves: TablebaseMove[];
}

export interface BookMove {
  uci: string;
  san: string;
  eco: string | null;
  name: string | null;
}

export type Loadable<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; code: string };

const epd = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
const memo = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let hit = memo.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = load();
    memo.set(key, hit);
    // Do not keep failures: the next visit may succeed.
    hit.catch(() => memo.delete(key));
    if (memo.size > 2_000) memo.delete(memo.keys().next().value as string);
  }
  return hit;
}

function useLoad<T>(key: string | null, load: () => Promise<T>): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: "idle" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` fully identifies `load`.
  useEffect(() => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    cached(key, load).then(
      (data) => live && setState({ status: "ok", data }),
      (e: unknown) =>
        live && setState({ status: "error", code: e instanceof ApiError ? e.code : "request_failed" }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}

let status: Promise<boolean> | null = null;

/** Asks the backend once per page whether online statistics are configured. */
function explorerAvailable(): Promise<boolean> {
  status ??= apiGet<{ available: boolean }>("/api/explorer/status").then(
    (r) => r.available,
    (e: unknown) => {
      status = null;
      throw e;
    },
  );
  return status;
}

export function useExplorer(fen: string, db: ExplorerDb | null): Loadable<ExplorerResult> {
  return useLoad(db ? `explorer|${db}|${epd(fen)}` : null, async () => {
    if (!(await explorerAvailable())) throw new ApiError("explorer_unavailable", 503);
    return apiGet<ExplorerResult>(`/api/explorer/${db}?fen=${encodeURIComponent(fen)}`);
  });
}

export function useTablebase(fen: string, enabled = true): Loadable<TablebaseResult> {
  const ok = enabled && isTablebasePosition(fen);
  return useLoad(ok ? `tb|${epd(fen)}` : null, () =>
    apiGet<TablebaseResult>(`/api/tablebase?fen=${encodeURIComponent(fen)}`),
  );
}

/** Legal moves from `fen` that stay inside the CC0 opening book, most named first. */
export async function bookMoves(fen: string): Promise<BookMove[]> {
  const data = await loadOpenings();
  const setup = parseFen(fen);
  if (setup.isErr) return [];
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return [];
  const out: BookMove[] = [];
  for (const [from, dests] of pos.value.allDests()) {
    for (const to of dests) {
      const move = { from, to };
      const child = pos.value.clone();
      const san = makeSan(child, move);
      child.play(move);
      const key = epd(makeFen(child.toSetup()));
      if (!data.book.has(key)) continue;
      const named = data.named[key];
      out.push({ uci: makeUci(move), san, eco: named?.[0] ?? null, name: named?.[1] ?? null });
    }
  }
  return out.sort((a, b) => Number(!!b.name) - Number(!!a.name) || a.san.localeCompare(b.san));
}

export function useBookMoves(fen: string, enabled: boolean): Loadable<BookMove[]> {
  return useLoad(enabled ? `book|${epd(fen)}` : null, () => bookMoves(fen));
}

/** Win/draw/loss category from White's point of view, for the eval bar badge. */
export function tablebaseWhiteOutcome(result: TablebaseResult, fen: string): "win" | "loss" | "draw" | null {
  const turn = fen.split(" ")[1] === "b" ? "black" : "white";
  const c = result.category;
  const mover =
    c === "win" || c === "syzygy-win" || c === "maybe-win"
      ? "win"
      : c === "loss" || c === "syzygy-loss" || c === "maybe-loss"
        ? "loss"
        : c === "draw" || c === "cursed-win" || c === "blessed-loss"
          ? "draw"
          : null;
  if (!mover || mover === "draw") return mover;
  return turn === "white" ? mover : mover === "win" ? "loss" : "win";
}
