// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside's own board palettes. Do not copy Chess.com/Lichess values (docs/LICENSING.md).

export interface BoardTheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  /** Last-move highlight (semi-transparent). */
  lastMove: string;
  /** Selected square + move-destination dots. */
  accent: string;
}

export const BOARD_THEMES = [
  {
    id: "walnut",
    name: "Walnut",
    light: "#eedcbc",
    dark: "#a8774f",
    lastMove: "rgba(205, 210, 106, 0.55)",
    accent: "rgba(48, 98, 54, 0.6)",
  },
  {
    id: "maple",
    name: "Maple",
    light: "#f4e6cc",
    dark: "#c99a63",
    lastMove: "rgba(214, 196, 84, 0.5)",
    accent: "rgba(80, 90, 40, 0.55)",
  },
  {
    id: "slate",
    name: "Slate",
    light: "#dfe5ec",
    dark: "#7889a0",
    lastMove: "rgba(120, 190, 220, 0.5)",
    accent: "rgba(30, 60, 110, 0.55)",
  },
  {
    id: "sage",
    name: "Sage",
    light: "#ebeedb",
    dark: "#7f9b6b",
    lastMove: "rgba(222, 214, 96, 0.55)",
    accent: "rgba(40, 80, 40, 0.6)",
  },
  {
    id: "ocean",
    name: "Ocean",
    light: "#d8e7f1",
    dark: "#4f7fa6",
    lastMove: "rgba(120, 210, 200, 0.5)",
    accent: "rgba(15, 50, 90, 0.6)",
  },
  {
    id: "rosewood",
    name: "Rosewood",
    light: "#f2ddd5",
    dark: "#a5665b",
    lastMove: "rgba(235, 190, 110, 0.55)",
    accent: "rgba(90, 30, 30, 0.55)",
  },
  {
    id: "graphite",
    name: "Graphite",
    light: "#d6d8db",
    dark: "#7c8188",
    lastMove: "rgba(150, 200, 120, 0.5)",
    accent: "rgba(30, 35, 40, 0.6)",
  },
  {
    id: "midnight",
    name: "Midnight",
    light: "#a3aec0",
    dark: "#46536a",
    lastMove: "rgba(110, 170, 230, 0.5)",
    accent: "rgba(10, 20, 40, 0.6)",
  },
  {
    id: "marble",
    name: "Marble",
    light: "#f3f1ec",
    dark: "#b6afa3",
    lastMove: "rgba(200, 200, 110, 0.5)",
    accent: "rgba(60, 60, 50, 0.55)",
  },
  {
    id: "amethyst",
    name: "Amethyst",
    light: "#ece4f2",
    dark: "#8a71a6",
    lastMove: "rgba(230, 190, 120, 0.5)",
    accent: "rgba(50, 25, 80, 0.55)",
  },
] as const satisfies readonly BoardTheme[];

export type BoardThemeId = (typeof BOARD_THEMES)[number]["id"];

export const DEFAULT_BOARD_THEME: BoardThemeId = "walnut";

export function boardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}
