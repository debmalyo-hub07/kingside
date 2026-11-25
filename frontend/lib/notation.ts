// SPDX-License-Identifier: AGPL-3.0-or-later
// Move display: plain SAN (Nf3) or figurine SAN (♘f3). Pure, safe to use in server components.

export type Notation = "san" | "figurine";

const WHITE: Record<string, string> = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" };
const BLACK: Record<string, string> = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" };

/**
 * Replaces piece letters in a SAN string with chess figurines. `color` is the side that played the move;
 * promotions (e8=Q) and castling stay readable.
 */
export function formatSan(san: string, notation: Notation, color: "white" | "black" = "white"): string {
  if (notation === "san" || san.startsWith("O-O")) return san;
  const glyphs = color === "white" ? WHITE : BLACK;
  return san.replace(/[KQRBN]/g, (letter) => glyphs[letter] ?? letter);
}

/** Side that played a move ending at `ply` (1 = White's first move). */
export function colorOfPly(ply: number): "white" | "black" {
  return ply % 2 === 1 ? "white" : "black";
}
