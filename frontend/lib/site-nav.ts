// SPDX-License-Identifier: AGPL-3.0-or-later
// Single source of truth for site navigation: header menus, mobile drawer, Ctrl+K palette, footer.
// Titles and descriptions live in messages/<locale>.json under nav.items.<id> / nav.groups.<id>.

import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  Crown,
  FileSearch,
  LayoutGrid,
  Library,
  LineChart,
  type LucideIcon,
  Puzzle,
  Settings,
  Swords,
} from "lucide-react";

export type NavItemId =
  | "analysis"
  | "editor"
  | "review"
  | "library"
  | "puzzles"
  | "daily"
  | "play"
  | "openings"
  | "endgames"
  | "practice"
  | "insights"
  | "settings";

export interface NavItem {
  id: NavItemId;
  href: string;
  icon: LucideIcon;
  /** Not built yet: shown with a "Soon" badge and not clickable. */
  soon?: boolean;
  keywords?: string[];
}

export interface NavGroup {
  id: "analyze" | "train" | "learn";
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "analyze",
    items: [
      {
        id: "analysis",
        href: "/analysis",
        icon: LineChart,
        keywords: ["engine", "stockfish", "pgn", "fen", "eval"],
      },
      { id: "editor", href: "/editor", icon: LayoutGrid, keywords: ["setup", "position", "fen"] },
      { id: "review", href: "/review", icon: FileSearch, keywords: ["import", "accuracy", "blunder"] },
      { id: "library", href: "/library", icon: Library, keywords: ["games", "history", "saved", "export"] },
      {
        id: "insights",
        href: "/insights",
        icon: BarChart3,
        keywords: ["stats", "progress", "accuracy", "openings"],
      },
    ],
  },
  {
    id: "train",
    items: [
      { id: "puzzles", href: "/puzzles", icon: Puzzle, keywords: ["tactics"] },
      { id: "daily", href: "/puzzles/daily", icon: CalendarDays },
      { id: "play", href: "/play", icon: Bot, keywords: ["computer", "practice"] },
    ],
  },
  {
    id: "learn",
    items: [
      { id: "openings", href: "/openings", icon: BookOpen, keywords: ["eco", "explorer", "masters"] },
      { id: "endgames", href: "/endgames", icon: Crown, keywords: ["tablebase", "syzygy"] },
      {
        id: "practice",
        href: "/practice",
        icon: Swords,
        keywords: ["endgame", "checkmate", "drill", "mistakes", "tactics"],
      },
    ],
  },
];

/** Reachable from the header icon, palette and footer (not part of a menu group). */
export const SETTINGS_ITEM: NavItem = {
  id: "settings",
  href: "/settings",
  icon: Settings,
  keywords: ["sound", "notation", "theme", "pieces", "board", "language"],
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
