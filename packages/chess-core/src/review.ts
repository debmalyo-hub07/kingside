// SPDX-License-Identifier: AGPL-3.0-or-later
// Game review: per-move classification, accuracy + Kingside Precision, phases, key moments, performance.
// Specification: docs/ALGORITHMS.md §2–§8. Pure functions, no engine access.

import type { Chess } from "chessops/chess";
import type { Color, Role, Square } from "chessops/types";
import { parseSquare, parseUci } from "chessops/util";
import { aggregatePrecision, moveAccuracy, movePrecision, precisionComplexityWeight } from "./accuracy";
import { positionFromFen, uciLineToSan } from "./game-tree";
import { PERFORMANCE_KNOTS, PERFORMANCE_KNOTS_BY_TIME } from "./performance-table";
import { SEE_VALUE, seeGe } from "./see";
import type { Score } from "./types";
import { labelWinFromScore, winPercentCheckmated, winPercentFromScore } from "./win-percent";

export type MoveClass =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "forced"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export const MOVE_CLASSES: readonly MoveClass[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "forced",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export interface EngineLine {
  /** UCI moves from this position. */
  pv: string[];
  /** White-POV score. */
  score: Score;
  depth: number;
}

export interface ReviewPosition {
  fen: string;
  /** Engine lines for this position, best first. Empty for finished positions. */
  lines: EngineLine[];
  /** Optional shallow probe lines (depth ~2..4) used for arXiv:2406.11895 surprise gating. */
  shallowLines?: EngineLine[];
  /** Optional Pass 1 lines preserved when Pass 2 re-searches a position deeper. */
  pass1Lines?: EngineLine[];
}

export interface ReviewMove {
  san: string;
  uci: string;
}

export interface ReviewInput {
  /** positions[0] is the start, positions[i + 1] follows moves[i]. */
  positions: ReviewPosition[];
  moves: ReviewMove[];
  /** Number of leading plies that are opening-book moves. */
  bookPlies: number;
  /** Players' ratings (from the PGN), used to anchor the performance estimate. */
  ratings?: { white: number | null; black: number | null };
  /** Time-control speed ("bullet" | "blitz" | "rapid" | "classical") for performance lookup. */
  timeClass?: string | null;
}

export interface MoveReview {
  ply: number;
  color: Color;
  san: string;
  classification: MoveClass;
  accuracy: number;
  /** Clean-room move precision (0..100) from expected-points loss. */
  precision: number;
  /** Mover-POV win % with best play before the move, and after the move. */
  winBefore: number;
  winAfter: number;
  /** Expected points lost, 0..1, on the label curve (§2a). */
  epLoss: number;
  /** The move offered material on purpose (§6.1, SEE-verified). */
  sacrifice: boolean;
  /** Engine's best move in SAN (undefined if none). */
  bestSan?: string;
  bestUci?: string;
  /** Engine's main line from the position before the move, in SAN (best move first, ≤ 8 plies). */
  bestLine?: string[];
  /** Engine's continuation after the played move, in SAN (≤ 8 plies). */
  replyLine?: string[];
  /** White-POV scores: best play before the move, and the position after it. */
  scoreBefore?: Score;
  scoreAfter?: Score;
  /** Search depth behind the verdict (deepest of the two positions). */
  depth?: number;
}

export type Phase = "opening" | "middlegame" | "endgame";

export interface PlayerSummary {
  /** Lichess-compatible Classic Accuracy (0..100). */
  accuracy: number | null;
  /** Clean-room complexity-calibrated Kingside Precision (0..100). */
  precision: number | null;
  phaseAccuracy: Record<Phase, number | null>;
  phasePrecision: Record<Phase, number | null>;
  counts: Record<MoveClass, number>;
  /** Average centipawn loss per own move (cp clamped ±1000, mates count as ±1000). null without moves. */
  acpl: number | null;
  /** Provisional single-game rating estimate; null when too few moves. */
  performance: number | null;
}

export interface GameReview {
  moves: MoveReview[];
  /** White win % per position (for the eval graph). */
  whiteWin: number[];
  /** Ply index where each phase starts (opening always 0). null = never reached. */
  phases: { middlegame: number | null; endgame: number | null };
  white: PlayerSummary;
  black: PlayerSummary;
  /** Ply numbers (1-based move index into moves) of the most important moments, in game order (§8). */
  keyMoments: number[];
  /** Ply of the last book move (0 when the game left the book at once). */
  lastBookPly: number;
}

// ---------- thresholds (docs/ALGORITHMS.md §6) ----------

const EP_BANDS: readonly [number, MoveClass][] = [
  [0.02, "excellent"],
  [0.05, "good"],
  [0.1, "inaccuracy"],
  [0.2, "mistake"],
];
/** Smallest piece value whose sacrifice can be brilliant for ≥ 1200 players (a minor piece). */
const SAC_MIN_VALUE = 3;
/** Minimum static exchange loss (in centipawns) for a direct sacrifice offer. */
const SAC_MIN_SEE_LOSS = 100;
/** A sound sacrifice may cost a little against the engine's top line and still be brilliant (§6.1). */
const BRILLIANT_MAX_EP_LOSS = 0.04;
/** Already completely winning (≈ +5.5 on the label curve) without it: a sacrifice is no longer brilliant. */
const BRILLIANT_MAX_WIN_BEFORE = 90;
/** Minimum shallow-vs-deep expected-points surprise gain (%) when shallow probe data is supplied. */
const BRILLIANT_SURPRISE_WIN = 2;
/** "Only move": the engine's second line loses at least this much (expected points, %) — §6.2. */
const GREAT_GAP_WIN = 10;
/** Turning-point non-recapture "only move" minimum gap (%). */
const GREAT_TURNING_GAP_WIN = 8;
/** Already clearly winning (≈ +3.5 on the label curve): finding the best move is not "great". */
const GREAT_MAX_WIN_BEFORE = 80;
const LINE_PLIES = 8;
const MISS_MIN_WIN = 70;
const MISS_DROP = 20;
const KEY_MOMENT_SWING = 15;
const MAX_KEY_MOMENTS = 12;
const KEY_CLASSES = new Set<MoveClass>(["blunder", "mistake", "miss", "brilliant", "great"]);
const MIN_MOVES_FOR_PERFORMANCE = 10;

const PIECE_VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

// ---------- helpers ----------

function opposite(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/** White win % of a position, handling finished games. */
function positionWhiteWin(pos: ReviewPosition): number {
  const chess = positionFromFen(pos.fen);
  if (chess.isCheckmate()) return winPercentCheckmated(chess.turn);
  if (chess.isEnd()) return 50;
  const best = pos.lines[0];
  return best ? winPercentFromScore(best.score) : 50;
}

/** White expected points of a position on the label curve (§2a), handling finished games. */
function positionWhiteLabel(pos: ReviewPosition): number {
  const chess = positionFromFen(pos.fen);
  if (chess.isCheckmate()) return chess.turn === "white" ? 0 : 100;
  if (chess.isEnd()) return 50;
  const best = pos.lines[0];
  return best ? labelWinFromScore(best.score) : 50;
}

/** White-POV centipawns for ACPL: clamped, mates count as the clamp. */
function cpOf(score: Score): number {
  if (score.mate !== undefined) return Math.sign(score.mate) * 1000;
  return Math.max(-1000, Math.min(1000, score.cp));
}

function moverWin(whiteWin: number, color: Color): number {
  return color === "white" ? whiteWin : 100 - whiteWin;
}

function legalMoveCount(chess: Chess): number {
  let n = 0;
  for (const dests of chess.allDests().values()) n += dests.size();
  return n;
}

/**
 * Returns squares of `defender`'s pieces (worth >= `minValue`) that the opponent (`opposite(defender)`)
 * can legally capture in `pos` with SEE >= `SEE_VALUE.pawn` (100 cp).
 */
function vulnerableSquares(pos: Chess, defender: Color, minValue: number): Set<Square> {
  const out = new Set<Square>();
  const attacker = opposite(defender);
  const probe = pos.turn === attacker ? pos : pos.clone();
  if (probe.turn !== attacker) {
    probe.turn = attacker;
    probe.epSquare = undefined;
  }
  const ctx = probe.ctx();
  for (const [from, dests] of probe.allDests(ctx)) {
    for (const to of dests) {
      const target = probe.board.get(to);
      if (!target || target.color !== defender || target.role === "king") continue;
      if (PIECE_VALUE[target.role] < minValue) continue;
      if (seeGe(probe, { from, to }, SEE_VALUE.pawn)) out.add(to);
    }
  }
  return out;
}

function bandFor(epLoss: number): MoveClass {
  for (const [limit, cls] of EP_BANDS) if (epLoss <= limit) return cls;
  return "blunder";
}

const SEVERITY: Record<MoveClass, number> = {
  brilliant: 0,
  great: 0,
  best: 0,
  book: 0,
  forced: 0,
  excellent: 1,
  good: 2,
  inaccuracy: 3,
  mistake: 4,
  miss: 4,
  blunder: 5,
};

// ---------- classification (§6) ----------

interface ClassifyContext {
  pos: Chess;
  afterPos: Chess;
  prevBefore?: ReviewPosition;
  before: ReviewPosition;
  after: ReviewPosition;
  move: ReviewMove;
  color: Color;
  winBefore: number;
  winAfter: number;
  epLoss: number;
  playedBest: boolean;
  isBook: boolean;
  previous: MoveClass | undefined;
  rating: number | null;
  sacrifice: boolean;
}

/**
 * True when the move offers material on purpose:
 * - Either a direct negative-SEE offer (`SEE <= -100` cp) by the moved piece (not a king/promotion), OR
 * - A counter-attack / desperado move leaving a piece (`>= minValue`) statically losable to the opponent
 *   when it was newly exposed by this move or newly attacked by the opponent's immediately preceding move.
 * Players rated < 1200 get leniency allowing sound pawn sacrifices.
 */
function isSacrifice(c: ClassifyContext): boolean {
  if (c.move.uci.length > 4) return false; // promotions are not sacrifices
  if (c.pos.isCheck()) return false; // getting out of check is not offering material
  if (c.afterPos.isCheckmate()) return false; // checkmating immediately ends the game

  const raw = parseUci(c.move.uci);
  if (!raw || !("from" in raw)) return false;
  const from = parseSquare(c.move.uci.slice(0, 2));
  const to = parseSquare(c.move.uci.slice(2, 4));
  if (from === undefined || to === undefined) return false;

  const moved = c.pos.board.get(from);
  if (!moved) return false;

  const lowRated = c.rating !== null && c.rating < 1200;
  const minValue = lowRated ? 1 : SAC_MIN_VALUE;

  // 1. Direct negative-SEE offer on the destination square.
  if (PIECE_VALUE[moved.role] >= minValue && !seeGe(c.pos, raw, -(SAC_MIN_SEE_LOSS - 1))) {
    return true;
  }

  // 2. Indirect / desperado / counter-attack offer: another piece left statically losable in `afterPos`.
  const afterVuln = vulnerableSquares(c.afterPos, c.color, minValue);
  if (afterVuln.size === 0) return false;

  const beforeVuln = vulnerableSquares(c.pos, c.color, minValue);
  const twoPliesAgoVuln = c.prevBefore
    ? vulnerableSquares(positionFromFen(c.prevBefore.fen), c.color, minValue)
    : null;

  for (const sq of afterVuln) {
    if (sq === to) {
      // Moved piece itself: already checked via direct SEE (e.g. equal capture isn't a sac).
      const captured = c.pos.board.get(to);
      if (captured && PIECE_VALUE[captured.role] >= PIECE_VALUE[moved.role]) continue;
      if (PIECE_VALUE[moved.role] >= minValue) return true;
      continue;
    }
    if (!beforeVuln.has(sq)) return true; // newly exposed by our move
    if (twoPliesAgoVuln && !twoPliesAgoVuln.has(sq)) return true; // newly attacked by opponent; counter-attacked
  }
  return false;
}

/**
 * Surprise signal (arXiv:2406.11895): when shallow probe lines (depth <= 4) are available, verifies that
 * either the shallow search did not pick the sacrifice #1 or deeper search improved its evaluation.
 * Deep Pass 1 lines (depth > 4) may confirm surprise if they missed or rose, but never veto when
 * shallow probe lines are absent (e.g. re-reviews from shared EvalCache).
 */
function hasBrilliantSurprise(c: ClassifyContext): boolean {
  const shallowBefore = c.before.shallowLines;
  const shallowAfter = c.after.shallowLines;
  const pass1Before = c.before.pass1Lines;
  const pass1After = c.after.pass1Lines;
  const hasShallow = Boolean(
    shallowBefore?.length ||
      shallowAfter?.length ||
      (pass1Before?.[0] && pass1Before[0].depth <= 4) ||
      (pass1After?.[0] && pass1After[0].depth <= 4),
  );
  if (!hasShallow) return true;

  if (shallowBefore?.length && shallowBefore[0]?.pv[0] !== c.move.uci) return true;

  if (shallowAfter?.[0]) {
    const shallowWinAfter = moverWin(labelWinFromScore(shallowAfter[0].score), c.color);
    if (c.winAfter - shallowWinAfter >= BRILLIANT_SURPRISE_WIN) return true;
  }
  if (shallowBefore?.[0]) {
    const shallowWinBefore = moverWin(labelWinFromScore(shallowBefore[0].score), c.color);
    if (c.winBefore - shallowWinBefore >= BRILLIANT_SURPRISE_WIN) return true;
  }
  if (pass1Before?.[0] && c.before.lines[0]) {
    if (pass1Before[0].pv[0] !== c.move.uci && c.playedBest) return true;
    const p1WinBefore = moverWin(labelWinFromScore(pass1Before[0].score), c.color);
    if (c.winBefore - p1WinBefore >= BRILLIANT_SURPRISE_WIN) return true;
  }
  if (pass1After?.[0]) {
    const p1WinAfter = moverWin(labelWinFromScore(pass1After[0].score), c.color);
    if (c.winAfter - p1WinAfter >= BRILLIANT_SURPRISE_WIN) return true;
  }
  return false;
}

/** Taking back on the square where the opponent just captured (a routine recapture unless turning point). */
function isRecapture(c: ClassifyContext, prev: ReviewMove | undefined): boolean {
  return (
    !!prev &&
    prev.san.includes("x") &&
    c.move.san.includes("x") &&
    prev.uci.slice(2, 4) === c.move.uci.slice(2, 4)
  );
}

/** True when opponent's prior error + our move turned a losing/equal game into an equal/winning one. */
function isTurningPoint(c: ClassifyContext): boolean {
  if (!c.prevBefore) return false;
  const oppErred =
    c.previous === "inaccuracy" ||
    c.previous === "mistake" ||
    c.previous === "blunder" ||
    c.previous === "miss";
  if (!oppErred) return false;

  const prevWin = moverWin(positionWhiteLabel(c.prevBefore), c.color);
  const swing = c.winAfter - prevWin;
  if (swing < 15) return false;
  // Losing/worse -> equal/better/winning, or equal/worse -> clearly better/winning.
  return (prevWin < 40 && c.winAfter >= 40) || (prevWin <= 60 && c.winAfter >= 65);
}

function classify(c: ClassifyContext, prev: ReviewMove | undefined): MoveClass {
  if (legalMoveCount(c.pos) === 1) return "forced";
  if (c.isBook) return "book";

  const second = c.before.lines[1];
  // "Completely winning even without it" is judged by the best alternative to the played move.
  const alternative =
    c.playedBest && second ? moverWin(labelWinFromScore(second.score), c.color) : c.winBefore;
  const maxEpLoss = c.rating !== null && c.rating < 1200 ? 0.05 : BRILLIANT_MAX_EP_LOSS;
  const nearBest = c.playedBest || c.epLoss <= maxEpLoss;
  if (
    nearBest &&
    c.sacrifice &&
    c.winBefore >= 30 &&
    alternative <= BRILLIANT_MAX_WIN_BEFORE &&
    c.winAfter >= 50 &&
    hasBrilliantSurprise(c)
  ) {
    return "brilliant";
  }

  const recapture = isRecapture(c, prev);
  const turning = isTurningPoint(c);
  if (
    (c.playedBest || c.epLoss <= 0.01) &&
    second &&
    (!recapture || turning) &&
    c.winBefore <= GREAT_MAX_WIN_BEFORE &&
    c.winAfter >= 40
  ) {
    const secondWin = moverWin(labelWinFromScore(second.score), c.color);
    const minGap = turning && !recapture ? GREAT_TURNING_GAP_WIN : GREAT_GAP_WIN;
    // "Only move": the next-best alternative loses substantially compared to the played move.
    if (c.winBefore - secondWin >= minGap) return "great";
  }

  const bestScore = c.before.lines[0]?.score;
  const afterScore = c.after.lines[0]?.score;
  const sign = c.color === "white" ? 1 : -1;
  const bestMate = bestScore?.mate !== undefined ? bestScore.mate * sign : undefined;
  const afterMate = afterScore?.mate !== undefined ? afterScore.mate * sign : undefined;

  // Missed forced mate (dropping to a non-mating win/equal position, without blundering into a loss).
  const missedForcedMate =
    bestMate !== undefined &&
    bestMate > 0 &&
    !c.afterPos.isCheckmate() &&
    !(afterMate !== undefined && afterMate > 0) &&
    c.epLoss > 0.08 &&
    c.winAfter >= 30;

  const opportunity =
    c.previous === "inaccuracy" ||
    c.previous === "mistake" ||
    c.previous === "blunder" ||
    c.previous === "miss";
  if (
    missedForcedMate ||
    (opportunity &&
      c.winBefore >= MISS_MIN_WIN &&
      c.winAfter <= c.winBefore - MISS_DROP &&
      c.epLoss > 0.1 &&
      c.winAfter >= 30)
  ) {
    return "miss";
  }

  // Delivering checkmate is always best even if the engine preferred an alternative mating move.
  if (c.afterPos.isCheckmate()) return "best";

  // Still mating, just slower.
  if (bestScore?.mate !== undefined && afterScore?.mate !== undefined && !c.playedBest) {
    const had = bestScore.mate * sign;
    const has = afterScore.mate * sign;
    if (had > 0 && has > 0) {
      const extra = has - (had - 1);
      return extra <= 0 ? "best" : extra <= 2 ? "excellent" : "good";
    }
  }

  if (c.playedBest) return "best";
  // Allowing an opponent forced mate from a non-lost position is always a blunder (§6).
  if (afterScore?.mate !== undefined && afterScore.mate * sign < 0 && c.winBefore >= 5) {
    return "blunder";
  }
  let cls = bandFor(c.epLoss);
  // Already lost: cap at inaccuracy. Already won and still won: floor at good.
  if (c.winBefore < 5 && SEVERITY[cls] > SEVERITY.inaccuracy) cls = "inaccuracy";
  if (c.winBefore > 97 && c.winAfter > 97 && SEVERITY[cls] > SEVERITY.good) cls = "good";
  return cls;
}

// ---------- accuracy (§3, §4) ----------

function stddev(xs: readonly number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
}

/**
 * Volatility weights, one per move, from the White win % series (§4).
 * Matches upstream Lichess AccuracyPercent.scala: windowSize = clamp(floor((n - 2) / 10), 2, 8).
 */
export function volatilityWeights(whiteWin: readonly number[]): number[] {
  const n = whiteWin.length;
  if (n < 2) return [];
  const size = Math.min(Math.max(Math.floor(Math.max(0, n - 2) / 10), 2), 8);
  const windows: number[][] = [];
  for (let i = 0; i < Math.min(size, n) - 2; i++) windows.push(whiteWin.slice(0, size));
  for (let i = 0; i + size <= n; i++) windows.push(whiteWin.slice(i, i + size));
  return windows.slice(0, n - 1).map((w) => Math.min(Math.max(stddev(w), 0.5), 12));
}

function aggregateAccuracy(accs: readonly number[], weights: readonly number[]): number | null {
  if (accs.length === 0) return null;
  const wSum = weights.reduce((a, b) => a + b, 0);
  const weighted = accs.reduce((a, acc, i) => a + acc * (weights[i] ?? 1), 0) / (wSum || accs.length);
  const harmonic = accs.length / accs.reduce((a, acc) => a + 1 / Math.max(acc, 1), 0);
  return (weighted + harmonic) / 2;
}

/**
 * Game accuracy for both players from a White win % series (one value per position, start first).
 * `firstMover` is the side that plays the first move of the series. docs/ALGORITHMS.md §4.
 */
export function gameAccuracy(
  whiteWin: readonly number[],
  firstMover: Color = "white",
): { white: number | null; black: number | null } {
  const weights = volatilityWeights(whiteWin);
  const acc = { white: [] as number[], black: [] as number[] };
  const w = { white: [] as number[], black: [] as number[] };
  for (let i = 0; i + 1 < whiteWin.length; i++) {
    const color: Color = (i % 2 === 0) === (firstMover === "white") ? "white" : "black";
    acc[color].push(
      moveAccuracy(moverWin(whiteWin[i] as number, color), moverWin(whiteWin[i + 1] as number, color)),
    );
    w[color].push(weights[i] ?? 1);
  }
  return { white: aggregateAccuracy(acc.white, w.white), black: aggregateAccuracy(acc.black, w.black) };
}

// ---------- phases (§5) ----------

function phaseFeatures(chess: Chess) {
  let majorsMinors = 0;
  let whiteBack = 0;
  let blackBack = 0;
  const grid: (Color | null)[] = new Array(64).fill(null);
  for (const [sq, piece] of chess.board) {
    if (piece.role !== "pawn" && piece.role !== "king") majorsMinors++;
    if (sq < 8 && piece.color === "white") whiteBack++;
    if (sq >= 56 && piece.color === "black") blackBack++;
    grid[sq] = piece.color;
  }
  // Own mixedness measure: 2x2 regions holding pieces of both colors.
  let mixed = 0;
  for (let r = 0; r < 7; r++) {
    for (let f = 0; f < 7; f++) {
      const cells = [r * 8 + f, r * 8 + f + 1, (r + 1) * 8 + f, (r + 1) * 8 + f + 1].map((s) => grid[s]);
      if (cells.includes("white") && cells.includes("black")) mixed++;
    }
  }
  return { majorsMinors, backrankSparse: whiteBack < 4 || blackBack < 4, mixed };
}

const MIDDLEGAME_PIECES = 10;
const ENDGAME_PIECES = 6;
const MIXED_THRESHOLD = 10;

export function detectPhases(fens: readonly string[]): GameReview["phases"] {
  let middlegame: number | null = null;
  let endgame: number | null = null;
  fens.forEach((fen, i) => {
    const f = phaseFeatures(positionFromFen(fen));
    if (
      middlegame === null &&
      (f.majorsMinors <= MIDDLEGAME_PIECES || f.backrankSparse || f.mixed >= MIXED_THRESHOLD)
    ) {
      middlegame = i;
    }
    if (endgame === null && f.majorsMinors <= ENDGAME_PIECES) {
      endgame = i;
      if (middlegame === null) middlegame = i;
    }
  });
  return { middlegame, endgame };
}

// ---------- performance estimate (§7) ----------

const PERFORMANCE_MIN = 400;
const PERFORMANCE_MAX = 3000;

/**
 * Typical Lichess rating of a player who plays one game at `accuracy`: linear between the fitted knots
 * (performance-table.ts, stratified by timeClass when available), end slopes extended outside them,
 * clamped and rounded to 50. A single game is a noisy signal (see docs/adr/0001-performance-model.md).
 */
export function estimatePerformance(
  accuracy: number | null,
  moveCount: number,
  timeClass?: string | null,
): number | null {
  if (accuracy === null || moveCount < MIN_MOVES_FOR_PERFORMANCE) return null;
  const speedKey = timeClass?.trim().toLowerCase();
  const k = (speedKey ? PERFORMANCE_KNOTS_BY_TIME[speedKey] : undefined) ?? PERFORMANCE_KNOTS;
  if (k.length < 2) return null;
  let i = 1;
  while (i < k.length - 1 && accuracy > (k[i] as readonly [number, number])[0]) i++;
  const [a0, r0] = k[i - 1] as readonly [number, number];
  const [a1, r1] = k[i] as readonly [number, number];
  const r = r0 + ((accuracy - a0) / (a1 - a0)) * (r1 - r0);
  return Math.round(Math.min(Math.max(r, PERFORMANCE_MIN), PERFORMANCE_MAX) / 50) * 50;
}

/** How far one game may move the estimate away from the player's own rating (§7). */
const ANCHOR_WEIGHT = 0.55;
const ANCHOR_MAX_SHIFT = 600;

/**
 * With a known rating, a single game moves the estimate part of the way from the player's rating towards
 * the accuracy-only estimate, at most ±600 (one game is a noisy signal). §7.
 */
export function anchoredPerformance(estimate: number | null, rating: number | null): number | null {
  if (estimate === null || rating === null || !Number.isFinite(rating) || rating <= 0) return estimate;
  const shift = Math.max(-ANCHOR_MAX_SHIFT, Math.min(ANCHOR_MAX_SHIFT, (estimate - rating) * ANCHOR_WEIGHT));
  return Math.round(Math.min(Math.max(rating + shift, PERFORMANCE_MIN), PERFORMANCE_MAX) / 50) * 50;
}

/** Most positions re-searched deeper in a review's second pass (§8b). */
const MAX_CRITICAL_POSITIONS = 24;
const CRITICAL_SWING = 8;

/**
 * Positions worth a deeper second search (MultiPV = 3, 4x nodes):
 * - Before and after every sacrifice, blunder, miss, mistake, inaccuracy
 * - Before non-obvious best / excellent moves & turning points (needed for MultiPV >= 2 Great checks)
 * - Every big win-probability swing
 * Most important first, at most 24. Indexes are into `positions` (0 = start). §8b.
 */
export function criticalPositions(review: GameReview, positionCount: number): number[] {
  const rank = (m: MoveReview, prev: MoveReview | undefined): { score: number; needAfter: boolean } => {
    if (m.classification === "book" || m.classification === "forced") return { score: 0, needAfter: false };
    if (m.sacrifice || m.classification === "brilliant" || m.classification === "great") {
      return { score: 6, needAfter: true };
    }
    if (m.classification === "blunder" || m.classification === "miss") return { score: 5, needAfter: true };
    if (m.classification === "mistake") return { score: 4, needAfter: true };
    const oppErred =
      prev &&
      (prev.classification === "inaccuracy" ||
        prev.classification === "mistake" ||
        prev.classification === "blunder" ||
        prev.classification === "miss");
    const isBestCandidate =
      (m.classification === "best" || m.epLoss <= 0.01) && m.winBefore <= 80 && m.winAfter >= 40;
    if (isBestCandidate && oppErred) return { score: 3, needAfter: false };
    if (m.classification === "inaccuracy") return { score: 2, needAfter: true };
    if (
      isBestCandidate &&
      (m.san.includes("x") || m.san.includes("+") || Math.abs(m.winBefore - m.winAfter) >= 5)
    ) {
      return { score: 2, needAfter: false };
    }
    if (Math.abs(m.winBefore - m.winAfter) >= CRITICAL_SWING) return { score: 1, needAfter: true };
    if (isBestCandidate && m.winBefore >= 25 && m.winBefore <= 75) return { score: 1, needAfter: false };
    return { score: 0, needAfter: false };
  };
  const picked: number[] = [];
  const seen = new Set<number>();
  const ordered = review.moves
    .map((m, idx) => ({ m, ...rank(m, review.moves[idx - 1]) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.m.ply - b.m.ply);
  for (const { m, needAfter } of ordered) {
    const indices = needAfter ? [m.ply - 1, m.ply] : [m.ply - 1];
    for (const idx of indices) {
      if (idx < 0 || idx >= positionCount || seen.has(idx)) continue;
      if (picked.length >= MAX_CRITICAL_POSITIONS) return picked;
      seen.add(idx);
      picked.push(idx);
    }
  }
  return picked;
}

// ---------- main ----------

function emptyCounts(): Record<MoveClass, number> {
  return Object.fromEntries(MOVE_CLASSES.map((c) => [c, 0])) as Record<MoveClass, number>;
}

export function reviewGame(input: ReviewInput): GameReview {
  const { positions, moves } = input;
  if (positions.length !== moves.length + 1) throw new Error("positions must be moves + 1");

  const whiteWin = positions.map(positionWhiteWin);
  const whiteLabel = positions.map(positionWhiteLabel);
  const weights = volatilityWeights(whiteWin);
  const reviews: MoveReview[] = [];

  moves.forEach((move, i) => {
    const before = positions[i] as ReviewPosition;
    const after = positions[i + 1] as ReviewPosition;
    const prevBefore = i > 0 ? positions[i - 1] : undefined;
    const pos = positionFromFen(before.fen);
    const afterPos = positionFromFen(after.fen);
    const color = pos.turn;
    const winBefore = moverWin(whiteWin[i] as number, color);
    const winAfter = moverWin(whiteWin[i + 1] as number, color);
    const labelBefore = moverWin(whiteLabel[i] as number, color);
    const labelAfter = moverWin(whiteLabel[i + 1] as number, color);
    const epLoss = Math.max(0, labelBefore - labelAfter) / 100;
    const bestUci = before.lines[0]?.pv[0];
    const bestLine = before.lines[0] ? uciLineToSan(before.fen, before.lines[0].pv.slice(0, LINE_PLIES)) : [];
    const bestSan = bestLine[0];
    const playedBest = bestSan !== undefined && bestSan === move.san;
    const replyLine = after.lines[0] ? uciLineToSan(after.fen, after.lines[0].pv.slice(0, LINE_PLIES)) : [];
    const ctx: ClassifyContext = {
      pos,
      afterPos,
      ...(prevBefore ? { prevBefore } : {}),
      before,
      after,
      move,
      color,
      winBefore: labelBefore,
      winAfter: labelAfter,
      epLoss,
      playedBest,
      isBook: i < input.bookPlies,
      previous: reviews[i - 1]?.classification,
      rating: input.ratings?.[color] ?? null,
      sacrifice: false,
    };
    ctx.sacrifice = isSacrifice(ctx);
    const classification = classify(ctx, moves[i - 1]);
    const scoreBefore = before.lines[0]?.score;
    const scoreAfter = after.lines[0]?.score;
    const depth = Math.max(before.lines[0]?.depth ?? 0, after.lines[0]?.depth ?? 0);
    reviews.push({
      ply: i + 1,
      color,
      san: move.san,
      classification,
      accuracy: moveAccuracy(winBefore, winAfter),
      precision: movePrecision(epLoss),
      winBefore,
      winAfter,
      epLoss,
      sacrifice: ctx.sacrifice,
      ...(bestSan ? { bestSan } : {}),
      ...(bestUci ? { bestUci } : {}),
      ...(bestLine.length ? { bestLine } : {}),
      ...(replyLine.length ? { replyLine } : {}),
      ...(scoreBefore ? { scoreBefore } : {}),
      ...(scoreAfter ? { scoreAfter } : {}),
      ...(depth ? { depth } : {}),
    });
  });

  const phases = detectPhases(positions.map((p) => p.fen));
  const phaseOf = (ply: number): Phase =>
    phases.endgame !== null && ply > phases.endgame
      ? "endgame"
      : phases.middlegame !== null && ply > phases.middlegame
        ? "middlegame"
        : "opening";

  const summarize = (color: Color): PlayerSummary => {
    const ownEntries = reviews.map((r, i) => ({ r, i })).filter(({ r }) => r.color === color);
    const own = ownEntries.map(({ r }) => r);
    const ownWeights = ownEntries.map(({ i }) => weights[i] ?? 1);
    const ownPrecWeights = ownEntries.map(({ r, i }) =>
      precisionComplexityWeight(r.winBefore, weights[i] ?? 1),
    );
    const counts = emptyCounts();
    for (const r of own) counts[r.classification]++;
    const accuracy = aggregateAccuracy(
      own.map((r) => r.accuracy),
      ownWeights,
    );
    const precision = aggregatePrecision(
      own.map((r) => r.precision),
      ownPrecWeights,
    );
    const phaseAccuracy = {} as Record<Phase, number | null>;
    const phasePrecision = {} as Record<Phase, number | null>;
    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      const idx = ownEntries.filter(({ r }) => phaseOf(r.ply) === phase);
      phaseAccuracy[phase] =
        idx.length >= 2
          ? aggregateAccuracy(
              idx.map(({ r }) => r.accuracy),
              idx.map(({ i }) => weights[i] ?? 1),
            )
          : null;
      phasePrecision[phase] =
        idx.length >= 2
          ? aggregatePrecision(
              idx.map(({ r }) => r.precision),
              idx.map(({ r, i }) => precisionComplexityWeight(r.winBefore, weights[i] ?? 1)),
            )
          : null;
    }
    const rating = input.ratings?.[color] ?? null;
    const losses = own
      .filter((r) => r.scoreBefore && r.scoreAfter)
      .map((r) => {
        const sign = color === "white" ? 1 : -1;
        return Math.max(0, (cpOf(r.scoreBefore as Score) - cpOf(r.scoreAfter as Score)) * sign);
      });
    return {
      accuracy,
      precision,
      phaseAccuracy,
      phasePrecision,
      counts,
      acpl: losses.length ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length) : null,
      performance: anchoredPerformance(estimatePerformance(accuracy, own.length, input.timeClass), rating),
    };
  };

  const swings = reviews
    .map((r) => ({ ply: r.ply, swing: Math.abs(r.winBefore - r.winAfter), cls: r.classification }))
    .filter((m) => m.swing >= KEY_MOMENT_SWING)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 5)
    .map((m) => m.ply);
  const special = reviews.filter((r) => KEY_CLASSES.has(r.classification)).map((r) => r.ply);
  const lastBookPly = Math.min(input.bookPlies, moves.length);
  const keyMoments = [...new Set([...(lastBookPly > 0 ? [lastBookPly] : []), ...swings, ...special])]
    .sort((a, b) => a - b)
    .slice(0, MAX_KEY_MOMENTS);

  return {
    moves: reviews,
    whiteWin,
    phases,
    white: summarize("white"),
    black: summarize(opposite("white")),
    keyMoments,
    lastBookPly,
  };
}
