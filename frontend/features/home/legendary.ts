// SPDX-License-Identifier: AGPL-3.0-or-later
// Which legendary games the home page shows, their order, and the annotated moments (glyphs on plies;
// the words live in messages/en.json under home.legendary.games.<id>.moments.<ply>).

import { create } from "zustand";
import { IMMORTAL, type LegendaryGame } from "./hero-game-data";

export const LEGENDARY_IDS = [
  "immortal",
  "evergreen",
  "opera",
  "lasker-bauer",
  "century",
  "kasparov-topalov",
] as const;
export type LegendaryId = (typeof LEGENDARY_IDS)[number];

/** Ply → classic annotation glyph (historic commentary, not engine verdicts). */
export const MOMENTS: Record<LegendaryId, Record<number, string>> = {
  immortal: { 33: "!?", 35: "!!", 37: "!", 43: "!!", 45: "#" },
  evergreen: { 39: "!!", 41: "!!", 43: "!", 47: "#" },
  opera: { 19: "!", 25: "!", 31: "!!", 33: "#" },
  "lasker-bauer": { 29: "!", 33: "!!", 39: "!" },
  century: { 22: "!!", 34: "!!", 82: "#" },
  "kasparov-topalov": { 47: "!!", 49: "!", 87: "!" },
};

let loading: Promise<LegendaryGame[]> | null = null;

/** All games; the five besides the hero's Immortal Game are loaded on demand (keeps the home page light). */
export function loadLegendary(): Promise<LegendaryGame[]> {
  loading ??= import("./legendary-games-data").then((m) => [IMMORTAL, ...m.LEGENDARY_GAMES]);
  return loading;
}

/** The game on the hero board (the legendary games section can switch it). */
export const useHeroGame = create<{ id: LegendaryId; set: (id: LegendaryId) => void }>()((set) => ({
  id: "immortal",
  set: (id) => set({ id }),
}));
