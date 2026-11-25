// SPDX-License-Identifier: AGPL-3.0-or-later
// Game-over detection for a sequence of positions (start first): FIDE rules applied automatically.

import { positionFromFen } from "./game-tree";

export type GameResult = "1-0" | "0-1" | "1/2-1/2";

export type EndReason =
  | "checkmate"
  | "stalemate"
  | "insufficient material"
  | "threefold repetition"
  | "fifty-move rule";

export interface GameOver {
  result: GameResult;
  reason: EndReason;
}

/** Position identity for repetition: board, side to move, castling rights, en passant. */
const repetitionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** null while the game goes on. `fens` = every position so far, start first. */
export function gameStatus(fens: readonly string[]): GameOver | null {
  const last = fens[fens.length - 1];
  if (!last) return null;
  const pos = positionFromFen(last);
  if (pos.isCheckmate()) return { result: pos.turn === "white" ? "0-1" : "1-0", reason: "checkmate" };
  if (pos.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (pos.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient material" };
  const key = repetitionKey(last);
  if (fens.filter((f) => repetitionKey(f) === key).length >= 3) {
    return { result: "1/2-1/2", reason: "threefold repetition" };
  }
  if (pos.halfmoves >= 100) return { result: "1/2-1/2", reason: "fifty-move rule" };
  return null;
}
