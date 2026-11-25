// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  clockFromComments,
  type GameReview,
  InvalidPositionError,
  mainlineFrom,
  nodesAlongPath,
  type ReviewMove,
  type ReviewPosition,
  treeFromPgn,
} from "@kingside/chess-core";
import { create } from "zustand";
import { addDrills, type Drill, pgnHash, saveGame, saveReview } from "@/lib/local-db";
import type { Opening } from "@/lib/openings";
import { useSettings } from "@/lib/settings-store";

export interface PlayerInfo {
  name: string;
  rating: number | null;
}

export interface ReviewMeta {
  white: PlayerInfo;
  black: PlayerInfo;
  result: string;
  date: string | null;
  url: string | null;
  timeClass: string | null;
  /** This device's player in the game, when known (imported by username or a remembered name). */
  me: "white" | "black" | null;
}

/**
 * Node budget per position (same verdict on any device), and a 4x budget for the critical positions of the
 * second pass. docs/ALGORITHMS.md §8b.
 */
export const DEPTH_PRESETS = [
  { id: "fast", label: "Fast", nodes: 150_000, recheckNodes: 600_000 },
  { id: "standard", label: "Standard", nodes: 400_000, recheckNodes: 1_600_000 },
  { id: "deep", label: "Deep", nodes: 1_500_000, recheckNodes: 6_000_000 },
] as const;
export type DepthPreset = (typeof DEPTH_PRESETS)[number]["id"];

type Stage = "select" | "analyzing" | "report";

interface ReviewStore {
  stage: Stage;
  preset: DepthPreset;
  meta: ReviewMeta | null;
  /** PGN of the reviewed main line (headers kept). */
  pgn: string;
  fens: string[];
  moves: ReviewMove[];
  /** Seconds each move took (from PGN [%clk] comments), null when unknown. */
  moveTimes: (number | null)[];
  positions: ReviewPosition[];
  progress: number;
  /** Second pass: positions to re-check, and how many are done. */
  recheck: { total: number; done: number };
  /** Full WASM download progress (0..1) while fetching the engine, or null when idle/cached. */
  download: number | null;
  review: GameReview | null;
  opening: Opening | null;
  /** Selected ply: 0 = start position, i = after moves[i - 1]. */
  ply: number;
  /** Message key under `review.errors` (translated by the view). */
  error: "analysisStopped" | null;
  setPreset: (preset: DepthPreset) => void;
  /** Parses the PGN mainline and starts analysis. Throws InvalidPositionError on bad or <2-ply PGN. */
  start: (pgn: string, meta?: Partial<ReviewMeta> & { allowShort?: boolean }) => void;
  setProgress: (done: number, positions: ReviewPosition[]) => void;
  setDownload: (fraction: number | null) => void;
  setRecheck: (total: number) => void;
  tickRecheck: () => void;
  finish: (review: GameReview, opening: Opening | null) => void;
  fail: (error: "analysisStopped") => void;
  reset: () => void;
  goTo: (ply: number) => void;
}

/**
 * Time spent per move from the remaining clock after each move: own previous clock − this clock + increment.
 * The first move of each side is measured from the base time of the TimeControl tag ("600+5").
 */
export function moveTimes(clocks: readonly (number | null)[], timeControl: string): (number | null)[] {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(timeControl.trim());
  const base = m ? Number(m[1]) : null;
  const inc = m?.[2] ? Number(m[2]) : 0;
  return clocks.map((c, i) => {
    if (c === null) return null;
    const prev = i >= 2 ? clocks[i - 2] : base;
    if (prev === null || prev === undefined) return null;
    return Math.max(0, Math.round((prev - c + (i >= 2 ? inc : 0)) * 10) / 10);
  });
}

/** Moves that become practice drills ("From your games"). */
const DRILL_CLASSES = new Set(["mistake", "blunder", "miss"]);

function header(headers: Map<string, string>, key: string): string | null {
  const v = headers.get(key);
  return v && v !== "?" && v !== "????.??.??" ? v : null;
}

function siteUrl(site: string | null): string | null {
  return site && /^https?:\/\//.test(site) ? site : null;
}

function deriveTimeClass(timeControl: string): string | null {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(timeControl.trim());
  if (!m) return null;
  const base = Number(m[1]);
  const inc = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(base)) return null;
  const est = base + 40 * inc;
  if (est < 180) return "bullet";
  if (est < 480) return "blitz";
  if (est < 1500) return "rapid";
  return "classical";
}

export const useReview = create<ReviewStore>()((set, get) => ({
  stage: "select",
  preset: "standard",
  meta: null,
  pgn: "",
  fens: [],
  moves: [],
  moveTimes: [],
  positions: [],
  progress: 0,
  recheck: { total: 0, done: 0 },
  download: null,
  review: null,
  opening: null,
  ply: 0,
  error: null,
  setPreset: (preset) => set({ preset }),
  start: (pgn, meta) => {
    const tree = treeFromPgn(pgn);
    const nodes = nodesAlongPath(tree, mainlineFrom(tree));
    if (nodes.length < 2) throw new InvalidPositionError("That game has no moves to review.", "ERR_NO_MOVES");
    if (nodes.length < 3 && !meta?.allowShort) {
      throw new InvalidPositionError("This game needs at least 2 half-moves to review.", "ERR_TOO_SHORT");
    }
    const h = tree.headers;
    const names = useSettings.getState().myNames.map((n) => n.toLowerCase());
    const whiteName = meta?.white?.name ?? header(h, "White") ?? "White";
    const blackName = meta?.black?.name ?? header(h, "Black") ?? "Black";
    const me =
      meta?.me ??
      (names.includes(whiteName.toLowerCase())
        ? "white"
        : names.includes(blackName.toLowerCase())
          ? "black"
          : null);
    const rating = (key: string) => {
      const n = Number(h.get(key));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    set({
      stage: "analyzing",
      meta: {
        white: meta?.white ?? { name: header(h, "White") ?? "White", rating: rating("WhiteElo") },
        black: meta?.black ?? { name: header(h, "Black") ?? "Black", rating: rating("BlackElo") },
        result: meta?.result ?? header(h, "Result") ?? "*",
        date: meta?.date ?? header(h, "Date") ?? header(h, "UTCDate"),
        url: meta?.url ?? siteUrl(header(h, "Site")),
        timeClass: meta?.timeClass ?? deriveTimeClass(h.get("TimeControl") ?? ""),
        me,
      },
      pgn,
      fens: nodes.map((n) => n.fen),
      moves: nodes.slice(1).map((n) => ({ san: n.san ?? "", uci: n.uci ?? "" })),
      moveTimes: moveTimes(
        nodes.slice(1).map((n) => clockFromComments(n.comments)),
        h.get("TimeControl") ?? "",
      ),
      positions: [],
      progress: 0,
      recheck: { total: 0, done: 0 },
      download: null,
      review: null,
      opening: null,
      ply: 0,
      error: null,
    });
  },
  setProgress: (done, positions) => set({ progress: done, positions }),
  setDownload: (download) => set({ download }),
  setRecheck: (total) => set({ recheck: { total, done: 0 } }),
  tickRecheck: () => set((s) => ({ recheck: { ...s.recheck, done: s.recheck.done + 1 } })),
  finish: (review, opening) => {
    const { meta, pgn, fens, moves, positions } = get();
    set({ stage: "report", review, opening, ply: 0, download: null });
    if (meta && pgn) {
      const gameHash = pgnHash(pgn);
      if (moves.length >= 2) {
        void saveReview({
          gameHash,
          white: meta.white.name,
          black: meta.black.name,
          whiteRating: meta.white.rating,
          blackRating: meta.black.rating,
          result: meta.result,
          me: meta.me,
          opening: opening?.name ?? null,
          eco: opening?.eco ?? null,
          timeClass: meta.timeClass,
          date: meta.date,
          reviewedAt: Date.now(),
          accuracy: { white: review.white.accuracy, black: review.black.accuracy },
          precision: { white: review.white.precision, black: review.black.precision },
          acpl: { white: review.white.acpl, black: review.black.acpl },
          phaseAccuracy: { white: review.white.phaseAccuracy, black: review.black.phaseAccuracy },
          counts: { white: review.white.counts, black: review.black.counts },
          moves: moves.length,
        });
      }
      const now = Date.now();
      const drills: Drill[] = review.moves
        .filter(
          (m) =>
            DRILL_CLASSES.has(m.classification) &&
            m.bestUci &&
            m.bestSan &&
            (meta.me === null || m.color === meta.me),
        )
        .map((m) => {
          const fen = fens[m.ply - 1] ?? "";
          const played = moves[m.ply - 1];
          return {
            id: `${fen.split(" ").slice(0, 4).join(" ")}|${played?.uci ?? ""}`,
            fen,
            color: m.color,
            playedSan: m.san,
            playedUci: played?.uci ?? "",
            bestSan: m.bestSan ?? "",
            bestUci: m.bestUci ?? "",
            classification: m.classification,
            lines: positions[m.ply - 1]?.lines ?? [],
            gameHash,
            ply: m.ply,
            white: meta.white.name,
            black: meta.black.name,
            opening: opening?.name ?? null,
            createdAt: now,
            box: 0,
            due: now,
            attempts: 0,
            solved: 0,
          };
        });
      void addDrills(drills);
    }
    // Every reviewed game lands in the local library (deduplicated by its moves).
    if (meta && pgn)
      void saveGame({
        pgn,
        white: meta.white.name,
        black: meta.black.name,
        result: meta.result,
        source: "review",
        playedAt: Date.now(),
        ...(opening ? { opening: opening.name } : {}),
      });
  },
  fail: (error) => set({ stage: "select", error, download: null }),
  reset: () =>
    set({
      stage: "select",
      review: null,
      positions: [],
      fens: [],
      moves: [],
      moveTimes: [],
      error: null,
      download: null,
    }),
  goTo: (ply) => set({ ply: Math.max(0, Math.min(ply, get().moves.length)) }),
}));
