// SPDX-License-Identifier: AGPL-3.0-or-later
// Small position helpers shared by frontend and backend (FEN normalization, tablebase eligibility, PGN building).

import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { addMove, createTree, type GameTree, mainlineFrom, positionFromFen, treeToPgn } from "./game-tree";

/** Largest piece count covered by the Lichess Syzygy tablebase. */
export const TABLEBASE_MAX_PIECES = 7;

/** Canonical FEN of a legal position. Throws InvalidPositionError on bad input. */
export function normalizeFen(fen: string): string {
  return makeFen(positionFromFen(fen).toSetup());
}

/** Pieces (including kings) on the board of a FEN. */
export function pieceCount(fen: string): number {
  const board = fen.trim().split(/\s+/)[0] ?? "";
  let n = 0;
  for (const ch of board) if (/[pnbrqk]/i.test(ch)) n++;
  return n;
}

/** Syzygy tables cover ≤ 7 pieces and no castling rights. */
export function isTablebasePosition(fen: string): boolean {
  const castling = fen.trim().split(/\s+/)[2] ?? "-";
  return pieceCount(fen) <= TABLEBASE_MAX_PIECES && castling === "-";
}

/** Number of plies along the main line of a tree. */
export function mainlineLength(tree: GameTree): number {
  return mainlineFrom(tree).length;
}

/** Builds a PGN from a start position and UCI moves (stops at the first illegal move). */
export function pgnFromUciMoves(
  startFen: string,
  ucis: readonly string[],
  headers: Readonly<Record<string, string>> = {},
): string {
  const tree = createTree(startFen);
  for (const [k, v] of Object.entries(headers)) if (v) tree.headers.set(k, v);
  let path: string[] = [];
  for (const uci of ucis) {
    const next = addMove(tree, path, uci);
    if (!next) break;
    path = next;
  }
  return treeToPgn(tree);
}

/** True when every move in `pv` is legal starting from `fen`. */
export function isLegalPv(fen: string, pv: readonly string[]): boolean {
  if (pv.length === 0) return false;
  try {
    const pos = positionFromFen(fen);
    for (const uci of pv) {
      const raw = parseUci(uci);
      if (!raw) return false;
      const move = normalizeMove(pos, raw);
      if (!pos.isLegal(move)) return false;
      pos.play(move);
    }
    return true;
  } catch {
    return false;
  }
}
