// SPDX-License-Identifier: AGPL-3.0-or-later
// Bitboard Static Exchange Evaluation (SEE) using chessops attack/ray bitboards.
// Evaluates whether a move's static capture sequence on the target square achieves >= `threshold` centipawns,
// accounting for X-ray slider batteries, en passant, promotions, and absolute king pins.

import { bishopAttacks, kingAttacks, knightAttacks, pawnAttacks, rookAttacks } from "chessops/attacks";
import { type Chess, castlingSide, normalizeMove } from "chessops/chess";
import type { SquareSet } from "chessops/squareSet";
import type { Color, Move, Role, Square } from "chessops/types";

export const SEE_VALUE: Record<Role, number> = {
  pawn: 100,
  knight: 300,
  bishop: 300,
  rook: 500,
  queen: 900,
  king: 20_000,
};

const ATTACKER_ORDER: readonly Role[] = ["pawn", "knight", "bishop", "rook", "queen", "king"];

function opposite(color: Color): Color {
  return color === "white" ? "black" : "white";
}

function attackersToSquare(pos: Chess, target: Square, occupied: SquareSet): SquareSet {
  const { board } = pos;
  return rookAttacks(target, occupied)
    .intersect(board.rooksAndQueens())
    .union(bishopAttacks(target, occupied).intersect(board.bishopsAndQueens()))
    .union(knightAttacks(target).intersect(board.knight))
    .union(kingAttacks(target).intersect(board.king))
    .union(pawnAttacks("black", target).intersect(board.pieces("white", "pawn")))
    .union(pawnAttacks("white", target).intersect(board.pieces("black", "pawn")))
    .intersect(occupied);
}

/**
 * Returns true if the static exchange evaluation of `rawMove` in `pos` is >= `threshold` centipawns.
 * Defaults to `threshold = 0` (does not lose material).
 */
export function seeGe(pos: Chess, rawMove: Move, threshold = 0): boolean {
  if (!("from" in rawMove)) return 0 >= threshold;
  if (castlingSide(pos, rawMove)) return 0 >= threshold;

  const move = normalizeMove(pos, rawMove);
  if (!("from" in move)) return 0 >= threshold;
  const { from, to } = move;
  const mover = pos.board.get(from);
  if (!mover) return 0 >= threshold;

  const captured = pos.board.get(to);
  const isEp = mover.role === "pawn" && pos.epSquare !== undefined && to === pos.epSquare && !captured;
  const epCapturedSq = isEp ? to + (pos.turn === "white" ? -8 : 8) : undefined;

  let swap = (captured ? SEE_VALUE[captured.role] : isEp ? SEE_VALUE.pawn : 0) - threshold;
  if (move.promotion) swap += SEE_VALUE[move.promotion] - SEE_VALUE.pawn;
  if (swap < 0) return false;

  const placedRole = move.promotion ?? mover.role;
  swap = SEE_VALUE[placedRole] - swap;
  if (swap <= 0) return true;

  let occupied = pos.board.occupied.without(from);
  if (epCapturedSq !== undefined) occupied = occupied.without(epCapturedSq);
  occupied = occupied.with(to);

  let stm = opposite(pos.turn);
  let res = true;

  for (;;) {
    const allAtt = attackersToSquare(pos, to, occupied);
    const stmAtt = allAtt.intersect(pos.board[stm]);
    if (stmAtt.isEmpty()) break;

    const stmKing = pos.board.kingOf(stm);
    const opp = opposite(stm);
    // Opponent pieces still on the board (the current occupant of `to` is removed when `stm` captures).
    const oppOcc = pos.board[opp].intersect(occupied).without(to);
    const oppOrth = oppOcc.intersect(pos.board.rooksAndQueens());
    const oppDiag = oppOcc.intersect(pos.board.bishopsAndQueens());

    let pickedSq: Square | undefined;
    let pickedRole: Role | undefined;

    for (const role of ATTACKER_ORDER) {
      const candidates = stmAtt.intersect(pos.board[role]);
      if (candidates.isEmpty()) continue;

      if (role === "king") {
        const kSq = candidates.first();
        if (kSq === undefined) break;
        const occWithoutKing = occupied.without(kSq);
        const oppDefends =
          rookAttacks(to, occWithoutKing).intersects(oppOrth) ||
          bishopAttacks(to, occWithoutKing).intersects(oppDiag) ||
          knightAttacks(to).intersects(oppOcc.intersect(pos.board.knight)) ||
          kingAttacks(to).intersects(oppOcc.intersect(pos.board.king)) ||
          pawnAttacks(stm, to).intersects(oppOcc.intersect(pos.board.pawn));
        if (!oppDefends) {
          pickedSq = kSq;
          pickedRole = "king";
        }
        break;
      }

      for (const sq of candidates) {
        if (stmKing !== undefined) {
          const nextOcc = occupied.without(sq);
          const kingExposed =
            rookAttacks(stmKing, nextOcc).intersects(oppOrth) ||
            bishopAttacks(stmKing, nextOcc).intersects(oppDiag);
          if (kingExposed) continue;
        }
        pickedSq = sq;
        pickedRole = role;
        break;
      }
      if (pickedSq !== undefined) break;
    }

    if (pickedSq === undefined || pickedRole === undefined) break;

    res = !res;
    swap = SEE_VALUE[pickedRole] - swap;
    if (swap < (res ? 1 : 0)) break;

    occupied = occupied.without(pickedSq);
    stm = opp;
  }

  return res;
}

/** Exact static exchange evaluation in centipawns (in multiples of 100 cp, exact via binary search). */
export function seeValue(pos: Chess, move: Move): number {
  let lo = -25_000;
  let hi = 25_000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (seeGe(pos, move, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
