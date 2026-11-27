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

interface FenSummary {
  epd: string;
  ply: number;
  pieces: number;
  whitePawns: number;
  blackPawns: number;
  castling: string;
  whiteRank2Mask: number;
  blackRank7Mask: number;
}

function summarizeFen(fen: string): FenSummary | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const board = parts[0] ?? "";
  const turn = parts[1] === "b" ? "b" : "w";
  const castling = parts[2] ?? "-";
  const fullmove = Math.max(1, Number(parts[5]) || 1);
  const ply = (fullmove - 1) * 2 + (turn === "b" ? 1 : 0);

  const ranks = board.split("/");
  if (ranks.length !== 8) return null;

  let pieces = 0;
  let whitePawns = 0;
  let blackPawns = 0;
  let whiteRank2Mask = 0;
  let blackRank7Mask = 0;

  for (let r = 0; r < 8; r++) {
    const rankStr = ranks[r] ?? "";
    let file = 0;
    for (const ch of rankStr) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
      } else if (/[pnbrqk]/i.test(ch)) {
        pieces++;
        if (ch === "P") {
          whitePawns++;
          if (r === 6) whiteRank2Mask |= 1 << file;
        } else if (ch === "p") {
          blackPawns++;
          if (r === 1) blackRank7Mask |= 1 << file;
        }
        file++;
      } else {
        return null;
      }
    }
    if (file !== 8) return null;
  }

  return {
    epd: parts.slice(0, 4).join(" "),
    ply,
    pieces,
    whitePawns,
    blackPawns,
    castling: castling === "-" ? "" : castling,
    whiteRank2Mask,
    blackRank7Mask,
  };
}

function isCastlingSubset(sub: string, sup: string): boolean {
  for (const ch of sub) {
    if (!sup.includes(ch)) return false;
  }
  return true;
}

/**
 * Heuristic to detect when two consecutive FENs cannot belong to the same game line
 * (e.g. switching games or opening a new position), so UCI engines can send `ucinewgame`.
 */
export function isUnrelatedGameFen(prevFen: string, nextFen: string): boolean {
  const prev = summarizeFen(prevFen);
  const next = summarizeFen(nextFen);
  if (!prev || !next) return true;
  if (prev.epd === next.epd) return false;
  if (prev.ply === next.ply) return true;

  const forward = next.ply > prev.ply;
  const earlier = forward ? prev : next;
  const later = forward ? next : prev;
  const plyDelta = later.ply - earlier.ply;

  if (later.pieces > earlier.pieces) return true;
  if (earlier.pieces - later.pieces > plyDelta) return true;
  if (later.whitePawns > earlier.whitePawns || later.blackPawns > earlier.blackPawns) return true;
  if (!isCastlingSubset(later.castling, earlier.castling)) return true;
  // Pawns on their starting rank cannot reappear once they have moved forward.
  if ((later.whiteRank2Mask & ~earlier.whiteRank2Mask) !== 0) return true;
  if ((later.blackRank7Mask & ~earlier.blackRank7Mask) !== 0) return true;

  return false;
}
