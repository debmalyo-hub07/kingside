// SPDX-License-Identifier: AGPL-3.0-or-later

import { INITIAL_BOARD_FEN } from "chessops/fen";

export interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export type EditorPresetId = "start" | "lucena" | "philidor" | "najdorf" | "caroKann" | "iqp";

export interface EditorPreset {
  id: EditorPresetId;
  fen: string;
}

export const EDITOR_PRESETS: readonly EditorPreset[] = [
  { id: "start", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { id: "lucena", fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1" },
  { id: "philidor", fen: "4k3/7R/r7/4PK2/8/8/8/8 b - - 0 1" },
  { id: "najdorf", fen: "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6" },
  { id: "caroKann", fen: "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3" },
  { id: "iqp", fen: "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2N2N2/PP2BPPP/R1BQ1RK1 w - - 0 9" },
];

/** Board part of a FEN -> map of square -> FEN char, for castling availability checks. */
export function pieceAt(boardFen: string, square: string): string | undefined {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const row = boardFen.split("/")[8 - rank];
  if (!row) return undefined;
  let col = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) col += Number(ch);
    else {
      if (col === file) return ch;
      col++;
    }
  }
  return undefined;
}

export function castlingString(boardFen: string, c: Castling): string {
  const ok = (king: string, kingSq: string, rook: string, rookSq: string) =>
    pieceAt(boardFen, kingSq) === king && pieceAt(boardFen, rookSq) === rook;
  let s = "";
  if (c.K && ok("K", "e1", "R", "h1")) s += "K";
  if (c.Q && ok("K", "e1", "R", "a1")) s += "Q";
  if (c.k && ok("k", "e8", "r", "h8")) s += "k";
  if (c.q && ok("k", "e8", "r", "a8")) s += "q";
  return s || "-";
}

export function isEnPassantConsistent(boardFen: string, turn: "w" | "b", ep: string): boolean {
  if (ep === "-") return true;
  if (!/^[a-h][36]$/.test(ep)) return false;
  const file = ep[0] as string;
  const rank = ep[1] as string;
  if (turn === "w" && rank === "6") {
    return (
      pieceAt(boardFen, `${file}5`) === "p" &&
      !pieceAt(boardFen, `${file}6`) &&
      !pieceAt(boardFen, `${file}7`)
    );
  }
  if (turn === "b" && rank === "3") {
    return (
      pieceAt(boardFen, `${file}4`) === "P" &&
      !pieceAt(boardFen, `${file}3`) &&
      !pieceAt(boardFen, `${file}2`)
    );
  }
  return false;
}

export function parseInitialEditorFen(fen: string | undefined) {
  const parts = (fen ?? "").trim().split(/\s+/);
  const board = parts[0] && parts[0].split("/").length === 8 ? parts[0] : INITIAL_BOARD_FEN;
  const castlingPart = parts[2] ?? "KQkq";
  return {
    board,
    turn: (parts[1] === "b" ? "b" : "w") as "w" | "b",
    castling: {
      K: castlingPart.includes("K"),
      Q: castlingPart.includes("Q"),
      k: castlingPart.includes("k"),
      q: castlingPart.includes("q"),
    },
    enPassant: parts[3] || "-",
    halfmoves: parts[4] || "0",
    fullmoves: parts[5] || "1",
  };
}
