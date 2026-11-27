// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DrawBrushes } from "chessground/draw";

/**
 * Chessground brush palette combining standard draw brushes with Kingside's
 * 6-tier candidate move arrow colors and distinct crimson Threat Mode arrows.
 */
export const BOARD_DRAW_BRUSHES: DrawBrushes = {
  green: { key: "g", color: "#15781B", opacity: 1, lineWidth: 10 },
  red: { key: "r", color: "#882020", opacity: 1, lineWidth: 10 },
  blue: { key: "b", color: "#003088", opacity: 1, lineWidth: 10 },
  yellow: { key: "y", color: "#e68f00", opacity: 1, lineWidth: 10 },
  paleBlue: { key: "pb", color: "#003088", opacity: 0.4, lineWidth: 15 },
  paleGreen: { key: "pg", color: "#15781B", opacity: 0.4, lineWidth: 15 },
  paleRed: { key: "pr", color: "#882020", opacity: 0.4, lineWidth: 15 },
  paleGrey: { key: "pgr", color: "#4a4a4a", opacity: 0.35, lineWidth: 15 },
  purple: { key: "purple", color: "#68217a", opacity: 0.65, lineWidth: 10 },
  pink: { key: "pink", color: "#ee2080", opacity: 0.5, lineWidth: 10 },
  white: { key: "white", color: "white", opacity: 1, lineWidth: 10 },
  candBest: { key: "cb", color: "#10b981", opacity: 1, lineWidth: 12 },
  candCyan: { key: "cc", color: "#06b6d4", opacity: 0.92, lineWidth: 10 },
  candTeal: { key: "ct", color: "#0d9488", opacity: 0.88, lineWidth: 9 },
  candAmber: { key: "ca", color: "#f59e0b", opacity: 0.84, lineWidth: 8 },
  candOrange: { key: "co", color: "#f97316", opacity: 0.8, lineWidth: 7 },
  candRose: { key: "cr", color: "#f43f5e", opacity: 0.76, lineWidth: 7 },
  threatCrimson: { key: "tc", color: "#dc2626", opacity: 0.95, lineWidth: 11 },
};
