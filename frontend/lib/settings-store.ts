// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type BoardThemeId, DEFAULT_BOARD_THEME } from "./board-themes";
import type { Notation } from "./notation";
import { DEFAULT_PIECE_SET, type PieceSetId } from "./piece-sets";

/** null depth = infinite search (until the position changes or the user stops it). */
export const DEPTH_OPTIONS = [12, 16, 20, 24, 28, 32, 40, null] as const;
export type EngineDepth = (typeof DEPTH_OPTIONS)[number];

export type HandleSite = "lichess" | "chesscom";

export interface RememberedHandle {
  site: HandleSite;
  name: string;
}

export interface Settings {
  boardTheme: BoardThemeId;
  pieceSet: PieceSetId;
  coordinates: boolean;
  animationMs: number;
  showBestArrow: boolean;
  engineEnabled: boolean;
  engineDepth: EngineDepth;
  engineLines: number;
  /** 0 = auto (cores - 1, max 8). */
  engineThreads: number;
  engineHashMb: number;
  /** Net for the live analysis board: full NNUE is strongest (default); lite is ~2× faster and optional. */
  analysisNet: "lite" | "full";
  soundEnabled: boolean;
  /** 0..1 */
  soundVolume: number;
  notation: Notation;
  /** Opening explorer source shown first. */
  explorerDb: "masters" | "lichess" | "book";
  /** Text box under the board for typing moves (e.g. "Nf3"). */
  moveInput: boolean;
  /** Review: label badge on the board square of the move. */
  reviewBadges: boolean;
  /** Review: green arrow for the engine's best move when the played move was not best. */
  reviewBestArrow: boolean;
  /** Review: red arrow for the opponent's strongest reply after an error. */
  reviewThreatArrow: boolean;
  /** Review: whose key moments "Next key moment" steps through. */
  reviewKeyFor: "both" | "white" | "black";
  /** Review: show time spent per move in the move list (when the PGN has clock times). */
  reviewMoveTimes: boolean;
  /** Review: primary headline score ("accuracy" = Classic Lichess Win%, "precision" = Kingside Precision). */
  reviewMetric: "accuracy" | "precision";
  /** Usernames this device looked up for review: their side of a game is "me" (insights, drills). */
  myNames: string[];
  /** Site-qualified handles remembered from /review lookups (`{ site, name }`). */
  recentHandles: RememberedHandle[];
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  rememberHandle: (site: HandleSite, name: string) => void;
  removeHandle: (site: HandleSite, name: string) => void;
  clearRememberedHandles: () => void;
  reset: () => void;
}

export const DEFAULT_SETTINGS: Settings = {
  boardTheme: DEFAULT_BOARD_THEME,
  pieceSet: DEFAULT_PIECE_SET,
  coordinates: true,
  animationMs: 200,
  showBestArrow: true,
  engineEnabled: true,
  engineDepth: 24,
  engineLines: 3,
  engineThreads: 0,
  engineHashMb: 64,
  analysisNet: "full",
  soundEnabled: true,
  soundVolume: 0.6,
  notation: "san",
  explorerDb: "masters",
  moveInput: false,
  reviewBadges: true,
  reviewBestArrow: true,
  reviewThreatArrow: true,
  reviewKeyFor: "both",
  reviewMoveTimes: true,
  reviewMetric: "accuracy",
  myNames: [],
  recentHandles: [],
};

// localStorage may throw (private mode, blocked storage); fall back to in-memory defaults.
const safeStorage = createJSONStorage(() => {
  try {
    const probe = "__kingside_probe__";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
  }
});

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      rememberHandle: (site, rawName) =>
        set((s) => {
          const name = rawName.trim();
          if (!name) return s;
          const lower = name.toLowerCase();
          const nextHandles = [
            { site, name },
            ...s.recentHandles.filter((h) => !(h.site === site && h.name.toLowerCase() === lower)),
          ].slice(0, 6);
          const nextNames = [name, ...s.myNames.filter((n) => n.toLowerCase() !== lower)].slice(0, 6);
          return { recentHandles: nextHandles, myNames: nextNames };
        }),
      removeHandle: (site, rawName) =>
        set((s) => {
          const lower = rawName.trim().toLowerCase();
          const nextHandles = s.recentHandles.filter(
            (h) => !(h.site === site && h.name.toLowerCase() === lower),
          );
          const stillReferenced = nextHandles.some((h) => h.name.toLowerCase() === lower);
          const nextNames = stillReferenced ? s.myNames : s.myNames.filter((n) => n.toLowerCase() !== lower);
          return { recentHandles: nextHandles, myNames: nextNames };
        }),
      clearRememberedHandles: () => set({ recentHandles: [], myNames: [] }),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    // Rehydrated by <SettingsHydrator> after mount so the server render matches the first client render.
    { name: "kingside-settings", version: 1, storage: safeStorage, skipHydration: true },
  ),
);
