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
import { ENGINE_NAME } from "@/engine/stockfish-engine";
import type { ImportedGame } from "@/lib/api";
import {
  addDrills,
  type Drill,
  evalKey,
  getCachedEvalsBatch,
  getGameByHash,
  getReview,
  pgnHash,
  type SavedReview,
  saveGame,
  saveReview,
} from "@/lib/local-db";
import { countBookPlies, loadOpenings, type Opening, openingOf } from "@/lib/openings";
import { useSettings } from "@/lib/settings-store";
import { buildHydratedReview } from "./review-hydrate";

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
export type ImportSite = "lichess" | "chesscom" | "pgn";
export type ReportStage = "overview" | "guided";
export type ReviewMobileTab = "guide" | "moves" | "summary";

const SESSION_STORAGE_KEY = "kingside:review-session:v1";
const LAST_SITE_STORAGE_KEY = "kingside:review-last-site";
const CACHE_ENGINE = `${ENGINE_NAME}|nodes`;
const CLOUD_CACHE_ENGINE = "lichess-cloud";
const SHALLOW_CACHE_ENGINE = `${ENGINE_NAME}|d2`;

interface PersistedReviewSession {
  stage: Stage;
  preset: DepthPreset;
  meta: ReviewMeta | null;
  pgn: string;
  ply: number;
  reportStage: ReportStage;
  orientation: "white" | "black";
  mobileTab: ReviewMobileTab;
  showMotifs: boolean;
  importSite: ImportSite;
  importUser: string;
  importSearched: string;
  fetchedGames: ImportedGame[] | null;
}

function isDepthPreset(v: unknown): v is DepthPreset {
  return v === "fast" || v === "standard" || v === "deep";
}

function isImportSite(v: unknown): v is ImportSite {
  return v === "lichess" || v === "chesscom" || v === "pgn";
}

export function readLastImportSite(): "lichess" | "chesscom" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem(LAST_SITE_STORAGE_KEY);
    return raw === "lichess" || raw === "chesscom" ? raw : null;
  } catch {
    return null;
  }
}

function writeLastImportSite(site: ImportSite): void {
  if (typeof window === "undefined" || (site !== "lichess" && site !== "chesscom")) return;
  try {
    window.localStorage?.setItem(LAST_SITE_STORAGE_KEY, site);
  } catch {
    // ignore
  }
}

function writeReviewSession(state: {
  stage: Stage;
  preset: DepthPreset;
  meta: ReviewMeta | null;
  pgn: string;
  ply: number;
  reportStage: ReportStage;
  orientation: "white" | "black";
  mobileTab: ReviewMobileTab;
  showMotifs: boolean;
  importSite: ImportSite;
  importUser: string;
  importSearched: string;
  fetchedGames: ImportedGame[] | null;
}): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const payload: PersistedReviewSession = {
      stage: state.stage,
      preset: state.preset,
      meta: state.meta,
      pgn: state.pgn,
      ply: state.ply,
      reportStage: state.reportStage,
      orientation: state.orientation,
      mobileTab: state.mobileTab,
      showMotifs: state.showMotifs,
      importSite: state.importSite,
      importUser: state.importUser,
      importSearched: state.importSearched,
      fetchedGames: state.fetchedGames,
    };
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore unavailable or quota-exceeded sessionStorage.
  }
}

export function readReviewSession(): PersistedReviewSession | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedReviewSession>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      stage: parsed.stage === "analyzing" || parsed.stage === "report" ? parsed.stage : "select",
      preset: isDepthPreset(parsed.preset) ? parsed.preset : "standard",
      meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : null,
      pgn: typeof parsed.pgn === "string" ? parsed.pgn : "",
      ply: typeof parsed.ply === "number" && Number.isFinite(parsed.ply) ? Math.max(0, parsed.ply) : 0,
      reportStage: parsed.reportStage === "guided" ? "guided" : "overview",
      orientation: parsed.orientation === "black" ? "black" : "white",
      mobileTab: parsed.mobileTab === "moves" || parsed.mobileTab === "summary" ? parsed.mobileTab : "guide",
      showMotifs: Boolean(parsed.showMotifs),
      importSite: isImportSite(parsed.importSite) ? parsed.importSite : "lichess",
      importUser: typeof parsed.importUser === "string" ? parsed.importUser : "",
      importSearched: typeof parsed.importSearched === "string" ? parsed.importSearched : "",
      fetchedGames: Array.isArray(parsed.fetchedGames) ? parsed.fetchedGames : null,
    };
  } catch {
    return null;
  }
}

export function clearReviewSessionStorage(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

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
  /** Most recently scanned position index (0..fens.length - 1) during analysis. */
  activeIndex: number | null;
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
  reportStage: ReportStage;
  orientation: "white" | "black";
  mobileTab: ReviewMobileTab;
  showMotifs: boolean;
  importSite: ImportSite;
  importUser: string;
  importSearched: string;
  fetchedGames: ImportedGame[] | null;
  pendingLookup: { site: "lichess" | "chesscom"; user: string } | null;
  hydrating: boolean;
  setPreset: (preset: DepthPreset) => void;
  setReportStage: (reportStage: ReportStage) => void;
  setOrientation: (orientation: "white" | "black") => void;
  setMobileTab: (mobileTab: ReviewMobileTab) => void;
  setShowMotifs: (showMotifs: boolean) => void;
  setImportState: (
    patch: Partial<Pick<ReviewStore, "importSite" | "importUser" | "importSearched" | "fetchedGames">>,
  ) => void;
  prepareImportLookup: (site: "lichess" | "chesscom", user: string) => void;
  consumePendingLookup: () => { site: "lichess" | "chesscom"; user: string } | null;
  /** Parses the PGN mainline and starts analysis. Throws InvalidPositionError on bad or <2-ply PGN. */
  start: (pgn: string, meta?: Partial<ReviewMeta> & { allowShort?: boolean }) => void;
  setProgress: (done: number, positions: ReviewPosition[], activeIndex?: number) => void;
  setDownload: (fraction: number | null) => void;
  setRecheck: (total: number) => void;
  tickRecheck: () => void;
  finish: (review: GameReview, opening: Opening | null) => void;
  fail: (error: "analysisStopped") => void;
  reset: () => void;
  goTo: (ply: number) => void;
  hydrateFromSaved: (opts: {
    pgn: string;
    savedReview?: SavedReview | undefined;
    metaOverride?: Partial<ReviewMeta> | undefined;
    ply?: number | undefined;
    reportStage?: ReportStage | undefined;
    orientation?: "white" | "black" | undefined;
    mobileTab?: ReviewMobileTab | undefined;
    showMotifs?: boolean | undefined;
  }) => Promise<boolean>;
  openSavedOrStart: (
    pgn: string,
    savedReview?: SavedReview | undefined,
    metaOverride?: Partial<ReviewMeta> | undefined,
  ) => Promise<"hydrated" | "started">;
  restoreFromSessionOrDb: (initialGameHash?: string, initialHashPly?: number | null) => Promise<boolean>;
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

function parseReviewPgn(
  pgn: string,
  meta?: Partial<ReviewMeta> & { allowShort?: boolean },
  saved?: SavedReview,
) {
  const tree = treeFromPgn(pgn);
  const nodes = nodesAlongPath(tree, mainlineFrom(tree));
  if (nodes.length < 2) throw new InvalidPositionError("That game has no moves to review.", "ERR_NO_MOVES");
  if (nodes.length < 3 && !meta?.allowShort) {
    throw new InvalidPositionError("This game needs at least 2 half-moves to review.", "ERR_TOO_SHORT");
  }
  const h = tree.headers;
  const names = useSettings.getState().myNames.map((n) => n.toLowerCase());
  const whiteName = meta?.white?.name ?? header(h, "White") ?? saved?.white ?? "White";
  const blackName = meta?.black?.name ?? header(h, "Black") ?? saved?.black ?? "Black";
  const me =
    meta?.me ??
    saved?.me ??
    (names.includes(whiteName.toLowerCase())
      ? "white"
      : names.includes(blackName.toLowerCase())
        ? "black"
        : null);
  const rating = (key: string) => {
    const n = Number(h.get(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const resolvedMeta: ReviewMeta = {
    white: meta?.white ?? { name: whiteName, rating: rating("WhiteElo") ?? saved?.whiteRating ?? null },
    black: meta?.black ?? { name: blackName, rating: rating("BlackElo") ?? saved?.blackRating ?? null },
    result: meta?.result ?? header(h, "Result") ?? saved?.result ?? "*",
    date: meta?.date ?? header(h, "Date") ?? header(h, "UTCDate") ?? saved?.date ?? null,
    url: meta?.url ?? siteUrl(header(h, "Site")),
    timeClass: meta?.timeClass ?? deriveTimeClass(h.get("TimeControl") ?? "") ?? saved?.timeClass ?? null,
    me,
  };
  return {
    meta: resolvedMeta,
    fens: nodes.map((n) => n.fen),
    moves: nodes.slice(1).map((n) => ({ san: n.san ?? "", uci: n.uci ?? "" })),
    moveTimes: moveTimes(
      nodes.slice(1).map((n) => clockFromComments(n.comments)),
      h.get("TimeControl") ?? "",
    ),
  };
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
  activeIndex: null,
  recheck: { total: 0, done: 0 },
  download: null,
  review: null,
  opening: null,
  ply: 0,
  error: null,
  reportStage: "overview",
  orientation: "white",
  mobileTab: "guide",
  showMotifs: false,
  importSite: "lichess",
  importUser: "",
  importSearched: "",
  fetchedGames: null,
  pendingLookup: null,
  hydrating: false,
  setPreset: (preset) => {
    set({ preset });
    writeReviewSession({ ...get(), preset });
  },
  setReportStage: (reportStage) => {
    set({ reportStage });
    writeReviewSession({ ...get(), reportStage });
  },
  setOrientation: (orientation) => {
    set({ orientation });
    writeReviewSession({ ...get(), orientation });
  },
  setMobileTab: (mobileTab) => {
    set({ mobileTab });
    writeReviewSession({ ...get(), mobileTab });
  },
  setShowMotifs: (showMotifs) => {
    set({ showMotifs });
    writeReviewSession({ ...get(), showMotifs });
  },
  setImportState: (patch) => {
    set(patch);
    if (patch.importSite) writeLastImportSite(patch.importSite);
    writeReviewSession({ ...get(), ...patch });
  },
  prepareImportLookup: (site, user) => {
    writeLastImportSite(site);
    set({
      stage: "select",
      meta: null,
      pgn: "",
      fens: [],
      moves: [],
      moveTimes: [],
      positions: [],
      progress: 0,
      activeIndex: null,
      recheck: { total: 0, done: 0 },
      download: null,
      review: null,
      opening: null,
      ply: 0,
      error: null,
      reportStage: "overview",
      mobileTab: "guide",
      showMotifs: false,
      hydrating: false,
      importSite: site,
      importUser: user,
      importSearched: "",
      fetchedGames: null,
      pendingLookup: { site, user },
    });
    writeReviewSession(get());
  },
  consumePendingLookup: () => {
    const req = get().pendingLookup;
    if (!req) return null;
    set({ pendingLookup: null });
    return req;
  },
  start: (pgn, meta) => {
    const parsed = parseReviewPgn(pgn, meta);
    const orientation = parsed.meta.me ?? "white";
    set({
      stage: "analyzing",
      meta: parsed.meta,
      pgn,
      fens: parsed.fens,
      moves: parsed.moves,
      moveTimes: parsed.moveTimes,
      positions: [],
      progress: 0,
      activeIndex: null,
      recheck: { total: 0, done: 0 },
      download: null,
      review: null,
      opening: null,
      ply: 0,
      error: null,
      reportStage: "overview",
      orientation,
      mobileTab: "guide",
      showMotifs: false,
      hydrating: false,
    });
    writeReviewSession(get());
  },
  setProgress: (done, positions, activeIndex) =>
    set({ progress: done, positions, activeIndex: activeIndex ?? null }),
  setDownload: (download) => set({ download }),
  setRecheck: (total) => set({ recheck: { total, done: 0 } }),
  tickRecheck: () => set((s) => ({ recheck: { ...s.recheck, done: s.recheck.done + 1 } })),
  finish: (review, opening) => {
    const { meta, pgn, fens, moves, positions } = get();
    const orientation = meta?.me ?? "white";
    set({
      stage: "report",
      review,
      opening,
      ply: 0,
      download: null,
      reportStage: "overview",
      orientation,
      mobileTab: "guide",
      showMotifs: false,
      hydrating: false,
    });
    writeReviewSession(get());
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
          classes: review.moves.map((m) => m.classification),
          pgn,
          whiteWin: review.whiteWin,
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
  fail: (error) => {
    set({ stage: "select", error, download: null, activeIndex: null, hydrating: false });
    writeReviewSession(get());
  },
  reset: () => {
    set({
      stage: "select",
      meta: null,
      pgn: "",
      review: null,
      opening: null,
      positions: [],
      activeIndex: null,
      fens: [],
      moves: [],
      moveTimes: [],
      ply: 0,
      error: null,
      download: null,
      reportStage: "overview",
      orientation: "white",
      mobileTab: "guide",
      showMotifs: false,
      hydrating: false,
    });
    writeReviewSession(get());
  },
  goTo: (ply) => {
    const clamped = Math.max(0, Math.min(ply, get().moves.length));
    set({ ply: clamped });
    writeReviewSession(get());
  },
  hydrateFromSaved: async ({
    pgn,
    savedReview,
    metaOverride,
    ply = 0,
    reportStage = "overview",
    orientation,
    mobileTab = "guide",
    showMotifs = false,
  }) => {
    let parsed: ReturnType<typeof parseReviewPgn>;
    try {
      parsed = parseReviewPgn(pgn, metaOverride, savedReview);
    } catch {
      return false;
    }

    const openingsPromise = loadOpenings().catch(() => null);
    const keys = parsed.fens.flatMap((fen) => [
      evalKey(fen, CACHE_ENGINE),
      evalKey(fen, CLOUD_CACHE_ENGINE),
      evalKey(fen, SHALLOW_CACHE_ENGINE),
    ]);
    const [openingsData, evalHits] = await Promise.all([openingsPromise, getCachedEvalsBatch(keys)]);

    const positions: ReviewPosition[] = parsed.fens.map((fen, idx) => {
      const nodeHit = evalHits[idx * 3];
      const cloudHit = evalHits[idx * 3 + 1];
      const shallowHit = evalHits[idx * 3 + 2];
      const primary = nodeHit?.lines.length ? nodeHit : cloudHit;
      return {
        fen,
        lines: primary?.lines ?? [],
        ...(shallowHit?.lines.length ? { shallowLines: shallowHit.lines } : {}),
      };
    });

    const bookPlies = openingsData ? countBookPlies(openingsData, parsed.fens.slice(1)) : 0;
    const opening = openingsData
      ? (openingOf(openingsData, parsed.fens.slice(0, bookPlies + 1)) ?? openingOf(openingsData, parsed.fens))
      : savedReview?.opening
        ? { eco: savedReview.eco ?? "", name: savedReview.opening }
        : null;

    const hydrated = buildHydratedReview({
      fens: parsed.fens,
      moves: parsed.moves,
      positions,
      bookPlies,
      ratings: { white: parsed.meta.white.rating, black: parsed.meta.black.rating },
      timeClass: parsed.meta.timeClass,
      savedReview,
    });
    if (!hydrated) return false;

    const clampedPly = Math.max(0, Math.min(ply, parsed.moves.length));
    set({
      stage: "report",
      meta: parsed.meta,
      pgn,
      fens: parsed.fens,
      moves: parsed.moves,
      moveTimes: parsed.moveTimes,
      positions,
      progress: parsed.fens.length,
      activeIndex: null,
      recheck: { total: 0, done: 0 },
      download: null,
      review: hydrated,
      opening,
      ply: clampedPly,
      error: null,
      reportStage,
      orientation: orientation ?? parsed.meta.me ?? "white",
      mobileTab,
      showMotifs,
      hydrating: false,
    });
    writeReviewSession(get());
    return true;
  },
  openSavedOrStart: async (pgn, savedReview, metaOverride) => {
    const hash = pgnHash(pgn);
    const sr = savedReview ?? (await getReview(hash));
    const ok = await get().hydrateFromSaved({ pgn, savedReview: sr, metaOverride });
    if (ok) return "hydrated";
    get().start(pgn, metaOverride);
    return "started";
  },
  restoreFromSessionOrDb: async (initialGameHash, initialHashPly) => {
    const session = readReviewSession();
    const lastSite = readLastImportSite();
    if (session) {
      // Returning to bare /review after reviewing a pasted PGN should not trap the user on the PGN tab.
      const nextImportSite =
        !initialGameHash && session.stage !== "select" && session.importSite === "pgn"
          ? (lastSite ?? "lichess")
          : session.importSite;
      set({
        preset: session.preset,
        importSite: nextImportSite,
        importUser: session.importUser,
        importSearched: session.importSearched,
        fetchedGames: session.fetchedGames,
      });
    } else if (lastSite) {
      set({ importSite: lastSite });
    }

    const canRestoreSessionGame =
      Boolean(initialGameHash) &&
      Boolean(session?.pgn) &&
      (session?.stage === "report" || session?.stage === "analyzing") &&
      pgnHash(session?.pgn ?? "") === initialGameHash;

    if (canRestoreSessionGame && session) {
      set({ hydrating: true });
      const hash = pgnHash(session.pgn);
      const sr = await getReview(hash);
      const targetPly =
        initialHashPly !== null && initialHashPly !== undefined ? initialHashPly : session.ply;
      const ok = await get().hydrateFromSaved({
        pgn: session.pgn,
        savedReview: sr,
        metaOverride: session.meta ?? undefined,
        ply: targetPly,
        reportStage: session.stage === "report" ? session.reportStage : "overview",
        orientation: session.orientation,
        mobileTab: session.mobileTab,
        showMotifs: session.showMotifs,
      });
      if (ok) return true;
      try {
        get().start(session.pgn, session.meta ?? undefined);
        return true;
      } catch {
        set({ hydrating: false });
        return false;
      }
    }

    if (initialGameHash) {
      set({ hydrating: true });
      const sr = await getReview(initialGameHash);
      const pgn = sr?.pgn ?? (await getGameByHash(initialGameHash))?.pgn;
      if (pgn) {
        const targetPly = initialHashPly !== null && initialHashPly !== undefined ? initialHashPly : 0;
        const ok = await get().hydrateFromSaved({
          pgn,
          savedReview: sr,
          ply: targetPly,
          reportStage: targetPly > 0 ? "guided" : "overview",
        });
        if (ok) return true;
        try {
          get().start(pgn, sr?.me ? { me: sr.me } : undefined);
          return true;
        } catch {
          set({ hydrating: false });
          return false;
        }
      }
      set({ hydrating: false });
    }

    return false;
  },
}));
