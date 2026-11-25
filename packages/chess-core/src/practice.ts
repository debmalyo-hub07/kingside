// SPDX-License-Identifier: AGPL-3.0-or-later
// Practice positions: goals the player must reach against the engine (docs/ALGORITHMS.md §11).

import { positionFromFen } from "./game-tree";
import type { Color, Score } from "./types";

export type PracticeGoal =
  /** Checkmate the opponent (optionally within `moves` of your own moves). */
  | { kind: "mate"; moves?: number }
  /** Promote a pawn and keep a winning position. */
  | { kind: "promote" }
  /** Hold the position for `moves` of your own moves without falling into a lost position. */
  | { kind: "draw"; moves: number }
  /** Reach an advantage of at least `cp` within `moves` of your own moves. */
  | { kind: "advantage"; cp: number; moves: number };

export type PracticeStatus = "ongoing" | "success" | "failure";

export interface PracticeState {
  /** Positions from the start (index 0) through the current one. */
  fens: readonly string[];
  /** UCI moves played so far (both sides). */
  moves: readonly string[];
  /** The side the player plays. */
  player: Color;
  /** Engine evaluation of the current position (White POV), when known. */
  score: Score | null;
}

/** Losing the win: below this (player POV, cp) a mate/promote goal fails. */
const WIN_LOST_CP = 150;
/** Hold-the-draw goals fail once the player is worse than this (cp). */
const DRAW_LOST_CP = -250;

function playerCp(score: Score, player: Color): number {
  const sign = player === "white" ? 1 : -1;
  if (score.mate !== undefined) return (score.mate > 0 ? 100_000 : -100_000) * sign;
  return score.cp * sign;
}

function isRepetition(fens: readonly string[]): boolean {
  const key = (f: string) => f.split(" ").slice(0, 4).join(" ");
  const last = fens.at(-1);
  if (!last) return false;
  return fens.filter((f) => key(f) === key(last)).length >= 3;
}

/** Number of the player's own moves made so far. */
export function playerMoves(state: PracticeState): number {
  const first = positionFromFen(state.fens[0] ?? "").turn;
  const n = state.moves.length;
  return first === state.player ? Math.ceil(n / 2) : Math.floor(n / 2);
}

/** Judges a practice attempt after every move (call it with the latest engine score when available). */
export function practiceStatus(goal: PracticeGoal, state: PracticeState): PracticeStatus {
  const fen = state.fens.at(-1);
  if (!fen) return "ongoing";
  const pos = positionFromFen(fen);
  const own = playerMoves(state);
  const drawn = (pos.isEnd() && !pos.isCheckmate()) || isRepetition(state.fens) || pos.halfmoves >= 100;
  const playerMated = pos.isCheckmate() && pos.turn === state.player;
  const opponentMated = pos.isCheckmate() && pos.turn !== state.player;
  const cp = state.score ? playerCp(state.score, state.player) : null;

  switch (goal.kind) {
    case "mate":
      if (opponentMated) return goal.moves === undefined || own <= goal.moves ? "success" : "failure";
      if (playerMated || drawn) return "failure";
      if (goal.moves !== undefined && own >= goal.moves && pos.turn === state.player) return "failure";
      if (cp !== null && cp < WIN_LOST_CP) return "failure";
      return "ongoing";
    case "promote": {
      if (playerMated || drawn) return "failure";
      if (opponentMated) return "success";
      const promoted = state.moves.some((m, i) => m.length === 5 && sideOfMove(state, i) === state.player);
      if (cp !== null && cp < WIN_LOST_CP) return "failure";
      // Success once a pawn has promoted and the engine still sees a win (or no score yet after promotion).
      if (promoted && (cp === null || cp >= WIN_LOST_CP))
        return pos.turn === state.player ? "success" : "ongoing";
      return "ongoing";
    }
    case "draw":
      if (playerMated) return "failure";
      if (drawn || opponentMated) return "success";
      if (cp !== null && cp < DRAW_LOST_CP) return "failure";
      return own >= goal.moves && pos.turn === state.player ? "success" : "ongoing";
    case "advantage":
      if (opponentMated) return "success";
      if (playerMated) return "failure";
      if (cp !== null && cp >= goal.cp && pos.turn === state.player) return "success";
      if (drawn) return "failure";
      return own >= goal.moves && pos.turn === state.player ? "failure" : "ongoing";
  }
}

function sideOfMove(state: PracticeState, index: number): Color {
  const first = positionFromFen(state.fens[0] ?? "").turn;
  return (index % 2 === 0) === (first === "white") ? "white" : "black";
}
