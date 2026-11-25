// SPDX-License-Identifier: AGPL-3.0-or-later
// Must match the sets downloaded by scripts/fetch-pieces.mjs (licenses in public/pieces/LICENSES.md).

export const PIECE_SETS = [
  { id: "cburnett", name: "Cburnett" },
  { id: "merida", name: "Merida" },
  { id: "chessnut", name: "Chessnut" },
  { id: "fantasy", name: "Fantasy" },
  { id: "spatial", name: "Spatial" },
  { id: "celtic", name: "Celtic" },
  { id: "pirouetti", name: "Pirouetti" },
  { id: "mpchess", name: "MPChess" },
  { id: "kiwen-suwi", name: "Kiwen-suwi" },
  { id: "firi", name: "Firi" },
  { id: "rhosgfx", name: "RhosGFX" },
  { id: "shapes", name: "Shapes" },
  { id: "pixel", name: "Pixel" },
  { id: "letter", name: "Letter" },
] as const;

export type PieceSetId = (typeof PIECE_SETS)[number]["id"];

export const DEFAULT_PIECE_SET: PieceSetId = "cburnett";

const ROLE_LETTER = { king: "K", queen: "Q", rook: "R", bishop: "B", knight: "N", pawn: "P" } as const;

export type Role = keyof typeof ROLE_LETTER;
export type PieceColor = "white" | "black";

export function pieceUrl(set: string, color: PieceColor, role: Role): string {
  return `/pieces/${set}/${color === "white" ? "w" : "b"}${ROLE_LETTER[role]}.svg`;
}

/** CSS custom properties consumed by components/board/board.css. */
export function pieceSetCssVars(set: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const color of ["white", "black"] as const) {
    for (const role of Object.keys(ROLE_LETTER) as Role[]) {
      vars[`--piece-${color}-${role}`] = `url(${pieceUrl(set, color, role)})`;
    }
  }
  return vars;
}
