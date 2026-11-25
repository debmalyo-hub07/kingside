// SPDX-License-Identifier: AGPL-3.0-or-later
// Why a move got its label, as structured reasons the UI turns into sentences (docs/ALGORITHMS.md §8c).
// Pure: reads positions + engine lines, never the engine itself.

import { attacks, bishopAttacks, ray, rookAttacks } from "chessops/attacks";
import type { Chess } from "chessops/chess";
import { normalizeMove } from "chessops/chess";
import type { SquareSet } from "chessops/squareSet";
import type { Color, Role, Square } from "chessops/types";
import { makeSquare, parseSquare, parseUci, squareRank } from "chessops/util";
import { positionFromFen } from "./game-tree";
import type { MoveReview, ReviewPosition } from "./review";
import { SEE_VALUE, seeGe } from "./see";

/** Piece names the UI translates. */
export type PieceName = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

/** Tactical motif names used when a missed best move held a tactic. */
export type TacticMotif =
  | "pin"
  | "skewer"
  | "discoveredAttack"
  | "doubleCheck"
  | "trappedPiece"
  | "backRank"
  | "deflection";

export type Reason =
  /** The played move keeps / delivers a forced mate. */
  | { code: "mates"; n: number }
  /** After the played move the opponent has a forced mate. */
  | { code: "allowsMate"; n: number }
  /** The mover had a forced mate and lost it. */
  | { code: "missedMate"; n: number }
  /** A piece of the mover is left to be taken (engine reply captures it). */
  | { code: "hangs"; piece: PieceName; square: string }
  /** The engine's reply attacks two or more pieces at once (or king and piece). */
  | { code: "allowsFork"; piece: PieceName; square: string }
  /** The move pins an enemy piece to a more valuable target. */
  | { code: "pins"; piece: PieceName; target: PieceName; square: string }
  /** The engine's reply pins one of the mover's pieces. */
  | { code: "allowsPin"; piece: PieceName; target: PieceName; square: string }
  /** The move skewers a high-value enemy piece to expose a piece behind it. */
  | { code: "skewers"; piece: PieceName; target: PieceName; square: string }
  /** The engine's reply skewers one of the mover's pieces. */
  | { code: "allowsSkewer"; piece: PieceName; target: PieceName; square: string }
  /** The move uncovers a discovered attack by a slider. */
  | { code: "discoveredAttack"; piece: PieceName; square: string }
  /** The engine's reply uncovers a discovered attack against the mover. */
  | { code: "allowsDiscoveredAttack"; piece: PieceName; square: string }
  /** The move delivers a double check. */
  | { code: "doubleCheck" }
  /** The engine's reply delivers a double check against the mover. */
  | { code: "allowsDoubleCheck" }
  /** The move traps an opponent piece with no safe escape square. */
  | { code: "trapsPiece"; piece: PieceName; square: string }
  /** Leaves one of the mover's pieces trapped with no safe escape. */
  | { code: "trappedPiece"; piece: PieceName; square: string }
  /** Threatens or exploits a back-rank check / mate. */
  | { code: "backRank"; square: string }
  /** Allows a back-rank check / mate along the punishing reply line. */
  | { code: "allowsBackRank"; square: string }
  /** Deflects or lures a key defender away from its duty. */
  | { code: "deflection"; piece: PieceName; square: string }
  /** Allows the opponent to deflect a defender along the reply line. */
  | { code: "allowsDeflection"; piece: PieceName; square: string }
  /** The missed best move executed a tactical motif. */
  | { code: "missedTactic"; motif: TacticMotif }
  /** Along the engine line after the move, the mover ends up this many pawns down. */
  | { code: "losesMaterial"; pawns: number }
  /** The best move would have won this much material. */
  | { code: "bestWinsMaterial"; pawns: number }
  /** The move gives up material on purpose and the position holds. */
  | { code: "sacrifice"; piece: PieceName; square: string }
  /** Every other move was clearly worse. */
  | { code: "onlyMove" }
  /** The opponent's previous move was an error and this move takes advantage of it. */
  | { code: "punishes" }
  /** Win chances moved from one category to another (e.g. equal → winning). */
  | { code: "swing"; from: Outlook; to: Outlook };

export type Outlook = "lost" | "worse" | "equal" | "better" | "winning";

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const LINE_PLIES = 4;
const MATERIAL_SWING = 2;

function opposite(color: Color): Color {
  return color === "white" ? "black" : "white";
}

function material(chess: Chess, color: Color): number {
  let n = 0;
  for (const [, p] of chess.board) n += (p.color === color ? 1 : -1) * VALUE[p.role];
  return n;
}

/** Plays a UCI line (stopping at the first illegal move) on a copy; returns the final position. */
function playLine(fen: string, ucis: readonly string[], plies: number): Chess {
  const pos = positionFromFen(fen);
  for (const uci of ucis.slice(0, plies)) {
    const raw = parseUci(uci);
    if (!raw) break;
    const move = normalizeMove(pos, raw);
    if (!pos.isLegal(move)) break;
    pos.play(move);
  }
  return pos;
}

/** Parses and plays one legal UCI move on a cloned copy, returning { pos, from, to } or null. */
function stepUci(base: Chess, uci: string | undefined): { pos: Chess; from: Square; to: Square } | null {
  if (!uci) return null;
  const raw = parseUci(uci);
  if (!raw || !("from" in raw)) return null;
  const move = normalizeMove(base, raw);
  if (!base.isLegal(move) || !("from" in move)) return null;
  const pos = base.clone();
  pos.play(move);
  return { pos, from: move.from, to: move.to };
}

/** Mover's material change along a line of `plies` from `fen`, ending after the mover's opponent replied. */
function materialDelta(fen: string, ucis: readonly string[], plies: number, color: Color): number {
  const start = positionFromFen(fen);
  return material(playLine(fen, ucis, plies), color) - material(start, color);
}

export function outlook(moverWin: number): Outlook {
  if (moverWin < 20) return "lost";
  if (moverWin < 40) return "worse";
  if (moverWin <= 60) return "equal";
  if (moverWin <= 80) return "better";
  return "winning";
}

/** First move of the engine's reply forks: the moved piece attacks the king or ≥ 2 pieces worth more than pawns. */
function forkAfterReply(afterFen: string, replyUci: string | undefined, victim: Color): Reason | null {
  const stepped = stepUci(positionFromFen(afterFen), replyUci);
  if (!stepped) return null;
  const { pos, to } = stepped;
  const piece = pos.board.get(to);
  if (!piece || piece.role === "king") return null;
  const targets = attacks(piece, to, pos.board.occupied).intersect(pos.board[victim]);
  let hits = 0;
  let king = false;
  for (const sq of targets) {
    const t = pos.board.get(sq);
    if (!t) continue;
    if (t.role === "king") king = true;
    else if (VALUE[t.role] > VALUE[piece.role] || (VALUE[t.role] >= 3 && VALUE[t.role] === VALUE[piece.role]))
      hits++;
  }
  return hits >= 2 || (king && hits >= 1)
    ? { code: "allowsFork", piece: piece.role, square: makeSquare(to) }
    : null;
}

/** Piece the engine's reply captures, if the mover just left it hanging (not a genuine recapture). */
function hungPiece(
  beforeFen: string,
  afterFen: string,
  replyUci: string | undefined,
  playedUci: string,
  wasCapture: boolean,
): Reason | null {
  if (!replyUci) return null;
  const pos = positionFromFen(afterFen);
  const raw = parseUci(replyUci);
  if (!raw || !("from" in raw)) return null;
  const victim = pos.board.get(raw.to);
  if (!victim || victim.role === "pawn" || victim.role === "king") return null;
  // Taking back on the square where the mover actually captured is a normal exchange, not a hung piece.
  const played = parseUci(playedUci);
  const isGenuineRecapture =
    wasCapture &&
    played !== undefined &&
    "to" in played &&
    played.to === raw.to &&
    positionFromFen(beforeFen).board.has(played.to);
  if (isGenuineRecapture) return null;
  return { code: "hangs", piece: victim.role, square: makeSquare(raw.to) };
}

function sliderAttacksForRole(role: Role, sq: Square, occupied: SquareSet) {
  if (role === "bishop") return bishopAttacks(sq, occupied);
  if (role === "rook") return rookAttacks(sq, occupied);
  if (role === "queen") return bishopAttacks(sq, occupied).union(rookAttacks(sq, occupied));
  return null;
}

/** Detects a Pin or Skewer created by playing `uci` on `basePos`. */
function detectPinOrSkewer(
  basePos: Chess,
  uci: string | undefined,
  attackerColor: Color,
  isGood: boolean,
): Reason | null {
  const stepped = stepUci(basePos, uci);
  if (!stepped) return null;
  const { pos, to } = stepped;
  const attacker = pos.board.get(to);
  if (!attacker || (attacker.role !== "bishop" && attacker.role !== "rook" && attacker.role !== "queen")) {
    return null;
  }
  const victim = opposite(attackerColor);
  const direct = sliderAttacksForRole(attacker.role, to, pos.board.occupied);
  if (!direct) return null;

  const frontTargets = direct.intersect(pos.board[victim]);
  for (const frontSq of frontTargets) {
    const front = pos.board.get(frontSq);
    if (!front) continue;
    const throughFront = sliderAttacksForRole(attacker.role, to, pos.board.occupied.without(frontSq));
    if (!throughFront) continue;
    const behind = throughFront.diff(direct).intersect(pos.board[victim]).intersect(ray(to, frontSq));
    for (const backSq of behind) {
      const back = pos.board.get(backSq);
      if (!back) continue;
      // Ensure `front` cannot simply capture the pinner/skewerer safely.
      const attackerDefended = pos.kingAttackers(to, attackerColor, pos.board.occupied).nonEmpty();
      if (
        pos.dests(frontSq).has(to) &&
        (front.role === "king" ? !attackerDefended : seeGe(pos, { from: frontSq, to }, 1))
      ) {
        continue;
      }

      // Pin: front piece is shielded in front of a king or strictly more valuable piece.
      if (
        front.role !== "king" &&
        VALUE[front.role] >= 3 &&
        (back.role === "king" || VALUE[back.role] > VALUE[front.role])
      ) {
        return {
          code: isGood ? "pins" : "allowsPin",
          piece: front.role,
          target: back.role,
          square: makeSquare(frontSq),
        };
      }
      // Skewer: high-value front piece (king or major/minor > back) forced to step aside.
      if (
        VALUE[back.role] >= 3 &&
        (front.role === "king" ||
          (VALUE[front.role] > VALUE[back.role] &&
            (VALUE[front.role] > VALUE[attacker.role] ||
              pos.kingAttackers(frontSq, attackerColor, pos.board.occupied).isEmpty())))
      ) {
        return {
          code: isGood ? "skewers" : "allowsSkewer",
          piece: front.role,
          target: back.role,
          square: makeSquare(frontSq),
        };
      }
    }
  }
  return null;
}

/** Detects Double Check or Discovered Attack uncovered when `uci` moves from its origin square. */
function detectDiscoveryOrDoubleCheck(
  basePos: Chess,
  uci: string | undefined,
  attackerColor: Color,
  isGood: boolean,
): Reason | null {
  const stepped = stepUci(basePos, uci);
  if (!stepped) return null;
  const { pos, from, to } = stepped;
  if (pos.isCheck() && pos.ctx().checkers.size() >= 2) {
    return { code: isGood ? "doubleCheck" : "allowsDoubleCheck" };
  }

  const victim = opposite(attackerColor);
  const sliders = basePos.board[attackerColor].intersect(basePos.board.sliders()).without(from);
  for (const sliderSq of sliders) {
    const slider = basePos.board.get(sliderSq);
    if (!slider) continue;
    const beforeMask = attacks(slider, sliderSq, basePos.board.occupied);
    if (!beforeMask.has(from)) continue; // piece at `from` was blocking this slider
    if (ray(sliderSq, from).has(to)) continue; // moved along the same ray, still blocking
    const newTargets = attacks(slider, sliderSq, pos.board.occupied)
      .diff(beforeMask)
      .intersect(pos.board[victim]);
    for (const targetSq of newTargets) {
      const target = pos.board.get(targetSq);
      if (!target) continue;
      if (target.role === "king") {
        return {
          code: isGood ? "discoveredAttack" : "allowsDiscoveredAttack",
          piece: slider.role,
          square: makeSquare(sliderSq),
        };
      }
      if (VALUE[target.role] >= 3) {
        // Test whether the discovered slider attack actually threatens material or accompanies a check.
        const probe = pos.clone();
        probe.turn = attackerColor;
        probe.epSquare = undefined;
        if (
          pos.isCheck() ||
          VALUE[target.role] > VALUE[slider.role] ||
          seeGe(probe, { from: sliderSq, to: targetSq }, SEE_VALUE.pawn)
        ) {
          return {
            code: isGood ? "discoveredAttack" : "allowsDiscoveredAttack",
            piece: slider.role,
            square: makeSquare(sliderSq),
          };
        }
      }
    }
  }
  return null;
}

/** True if `victim`'s piece on `sq` has at least one move with SEE > -100 cp. */
function pieceHasSafeEscape(pos: Chess, victimColor: Color, sq: Square): boolean {
  const victimProbe = pos.turn === victimColor ? pos : pos.clone();
  if (victimProbe.turn !== victimColor) {
    victimProbe.turn = victimColor;
    victimProbe.epSquare = undefined;
  }
  if (victimProbe.isCheck()) return true;
  const ctx = victimProbe.ctx();
  for (const dest of victimProbe.dests(sq, ctx)) {
    if (seeGe(victimProbe, { from: sq, to: dest }, -(SEE_VALUE.pawn - 1))) return true;
  }
  return false;
}

/** Detects a trapped piece (`>= minor`) that is attacked and has no safe legal escape square. */
function detectTrappedPiece(pos: Chess, victimColor: Color, isGood: boolean): Reason | null {
  const attackerColor = opposite(victimColor);
  const oppProbe = pos.turn === attackerColor ? pos : pos.clone();
  if (oppProbe.turn !== attackerColor) {
    oppProbe.turn = attackerColor;
    oppProbe.epSquare = undefined;
  }
  const victimProbe = pos.turn === victimColor ? pos : pos.clone();
  if (victimProbe.turn !== victimColor) {
    victimProbe.turn = victimColor;
    victimProbe.epSquare = undefined;
  }
  if (victimProbe.isCheck()) return null;

  const ctx = victimProbe.ctx();
  for (const [sq, piece] of victimProbe.board) {
    if (piece.color !== victimColor || piece.role === "king" || piece.role === "pawn") continue;
    // Must actually be under immediate static threat of loss.
    let threatened = false;
    for (const attSq of oppProbe.kingAttackers(sq, attackerColor, oppProbe.board.occupied)) {
      if (oppProbe.dests(attSq).has(sq) && seeGe(oppProbe, { from: attSq, to: sq }, SEE_VALUE.pawn)) {
        threatened = true;
        break;
      }
    }
    if (!threatened) continue;

    // Every legal move of this piece loses material (SEE <= -100 cp).
    const dests = victimProbe.dests(sq, ctx);
    let hasSafeEscape = false;
    for (const dest of dests) {
      if (seeGe(victimProbe, { from: sq, to: dest }, -(SEE_VALUE.pawn - 1))) {
        hasSafeEscape = true;
        break;
      }
    }
    if (!hasSafeEscape) {
      return {
        code: isGood ? "trapsPiece" : "trappedPiece",
        piece: piece.role,
        square: makeSquare(sq),
      };
    }
  }
  return null;
}

function isNewlyTrapped(
  beforePos: Chess,
  afterPos: Chess,
  victimColor: Color,
  moverUci: string | undefined,
  isGood: boolean,
): Reason | null {
  const afterTrap = detectTrappedPiece(afterPos, victimColor, isGood);
  if (!afterTrap || !("square" in afterTrap)) return null;
  const prevTrap = detectTrappedPiece(beforePos, victimColor, isGood);
  if (prevTrap && "square" in prevTrap && prevTrap.square === afterTrap.square) return null;

  const targetSq = parseSquare(afterTrap.square);
  if (targetSq !== undefined && !pieceHasSafeEscape(beforePos, victimColor, targetSq)) {
    const stepped = moverUci ? stepUci(beforePos, moverUci) : null;
    const movedPiece = stepped ? stepped.pos.board.get(stepped.to) : undefined;
    const attacksTarget = Boolean(
      stepped && movedPiece && attacks(movedPiece, stepped.to, stepped.pos.board.occupied).has(targetSq),
    );
    if (!attacksTarget) return null;
  }
  return afterTrap;
}

/** Detects a back-rank check / mate threat along `ucis` by `attackerColor`. */
function detectBackRank(
  startFen: string,
  ucis: readonly string[],
  attackerColor: Color,
  isGood: boolean,
): Reason | null {
  const backRank = attackerColor === "white" ? 7 : 0;
  const victim = opposite(attackerColor);
  let cur = positionFromFen(startFen);
  const seq = ucis.slice(0, LINE_PLIES);

  for (let i = 0; i < seq.length; i++) {
    const stepped = stepUci(cur, seq[i]);
    if (!stepped) break;
    const movedByAttacker = cur.turn === attackerColor;
    cur = stepped.pos;
    if (!movedByAttacker) continue;

    const piece = cur.board.get(stepped.to);
    if (!piece || (piece.role !== "rook" && piece.role !== "queen")) continue;
    if (squareRank(stepped.to) !== backRank || !cur.isCheck()) continue;

    const kingSq = cur.board.kingOf(victim);
    if (kingSq === undefined || squareRank(kingSq) !== backRank) continue;

    if (cur.isCheckmate()) {
      return { code: isGood ? "backRank" : "allowsBackRank", square: makeSquare(stepped.to) };
    }
    // Trapped on back rank by own pawns/pieces (no legal king move off the back rank).
    const kingDests = cur.dests(kingSq);
    let escapesOffBackRank = false;
    for (const kd of kingDests) {
      if (squareRank(kd) !== backRank) {
        escapesOffBackRank = true;
        break;
      }
    }
    if (!escapesOffBackRank) {
      // Ignore spite checks where the opponent immediately captures the checking piece without mate.
      const nextUci = seq[i + 1];
      const nextRaw = nextUci ? parseUci(nextUci) : undefined;
      if (nextRaw && "to" in nextRaw && nextRaw.to === stepped.to) {
        continue;
      }
      return { code: isGood ? "backRank" : "allowsBackRank", square: makeSquare(stepped.to) };
    }
  }
  return null;
}

/** Detects a 3-ply deflection / removing-the-defender tactic along `ucis`. */
function detectDeflection(
  startFen: string,
  ucis: readonly string[],
  attackerColor: Color,
  isGood: boolean,
): Reason | null {
  if (ucis.length < 3) return null;
  const p0 = positionFromFen(startFen);
  if (p0.turn !== attackerColor) return null;
  const s1 = stepUci(p0, ucis[0]);
  if (!s1) return null;
  const s2 = stepUci(s1.pos, ucis[1]);
  if (!s2) return null;
  const s3 = stepUci(s2.pos, ucis[2]);
  if (!s3) return null;

  const s3Raw = parseUci(ucis[2] ?? "");
  if (!s3Raw || !("from" in s3Raw)) return null;

  // Defender moved in ply 2 (`s2`), either capturing the decoy at `s1.to` or evading a check.
  if (s2.to !== s1.to && !s1.pos.isCheck()) return null;
  const defender = s1.pos.board.get(s2.from);
  if (!defender || s2.from === s3.to || s3.to === s1.to || s3.to === s2.to) return null;

  const guardedBefore = attacks(defender, s2.from, s1.pos.board.occupied).has(s3.to);
  const guardedAfter = attacks(defender, s2.to, s2.pos.board.occupied).has(s3.to);
  if (!guardedBefore || guardedAfter) return null;

  const target = s2.pos.board.get(s3.to);
  if (s3.pos.isCheckmate() || (target && VALUE[target.role] >= 3)) {
    return {
      code: isGood ? "deflection" : "allowsDeflection",
      piece: defender.role,
      square: makeSquare(s2.from),
    };
  }
  return null;
}

function toMissedTactic(r: Reason | null): Reason | null {
  if (!r) return null;
  switch (r.code) {
    case "pins":
      return { code: "missedTactic", motif: "pin" };
    case "skewers":
      return { code: "missedTactic", motif: "skewer" };
    case "discoveredAttack":
      return { code: "missedTactic", motif: "discoveredAttack" };
    case "doubleCheck":
      return { code: "missedTactic", motif: "doubleCheck" };
    case "trapsPiece":
      return { code: "missedTactic", motif: "trappedPiece" };
    case "backRank":
      return { code: "missedTactic", motif: "backRank" };
    case "deflection":
      return { code: "missedTactic", motif: "deflection" };
    default:
      return null;
  }
}

/**
 * Up to two reasons for a move's label, most telling first. `before`/`after` are the review positions around
 * the move; `previous` is the opponent's last move review (for "punishes").
 */
export function explainMove(
  m: MoveReview,
  before: ReviewPosition,
  after: ReviewPosition,
  playedUci: string,
  previous?: MoveReview,
): Reason[] {
  const out: Reason[] = [];
  const sign = m.color === "white" ? 1 : -1;
  const bestMate = m.scoreBefore?.mate !== undefined ? m.scoreBefore.mate * sign : undefined;
  const afterMate = m.scoreAfter?.mate !== undefined ? m.scoreAfter.mate * sign : undefined;
  const reply = after.lines[0]?.pv;
  const best = before.lines[0]?.pv;
  const cls = m.classification;

  if (cls === "book" || cls === "forced") return out;

  const afterPos = positionFromFen(after.fen);
  const mated = afterPos.isCheckmate();
  // "Mate in n" counted the usual way: including the move just played.
  if (afterMate !== undefined && afterMate > 0) out.push({ code: "mates", n: afterMate + 1 });
  const alreadyMated = bestMate !== undefined && bestMate < 0;
  if (afterMate !== undefined && afterMate < 0 && !alreadyMated)
    out.push({ code: "allowsMate", n: -afterMate });
  if (bestMate !== undefined && bestMate > 0 && !mated && !(afterMate !== undefined && afterMate > 0)) {
    out.push({ code: "missedMate", n: bestMate });
  }

  if (cls === "brilliant") {
    const to = parseUci(playedUci);
    const piece = to && "to" in to ? afterPos.board.get(to.to) : undefined;
    if (piece && to && "to" in to)
      out.push({ code: "sacrifice", piece: piece.role, square: makeSquare(to.to) });
  }
  if (cls === "great") out.push({ code: previous && isError(previous) ? "punishes" : "onlyMove" });

  const isBad = cls === "inaccuracy" || cls === "mistake" || cls === "blunder" || cls === "miss";
  if (isBad) {
    const fork = forkAfterReply(after.fen, reply?.[0], m.color);
    const hung = hungPiece(before.fen, after.fen, reply?.[0], playedUci, m.san.includes("x"));
    if (hung && out.length < 2) out.push(hung);
    else if (fork && out.length < 2) out.push(fork);

    // Tactical motifs along the opponent's punishing reply.
    const beforePos = positionFromFen(before.fen);
    if (out.length < 2 && reply?.length) {
      const opp = opposite(m.color);
      const replyFirst = stepUci(afterPos, reply[0]);
      const prevTrap = detectTrappedPiece(beforePos, m.color, false);
      const afterTrap =
        detectTrappedPiece(afterPos, m.color, false) ??
        (replyFirst ? detectTrappedPiece(replyFirst.pos, m.color, false) : null);
      const newTrap =
        afterTrap &&
        (!prevTrap ||
          !("square" in prevTrap) ||
          !("square" in afterTrap) ||
          prevTrap.square !== afterTrap.square)
          ? afterTrap
          : null;
      const replyMotifs = [
        detectBackRank(after.fen, reply, opp, false),
        detectDiscoveryOrDoubleCheck(afterPos, reply[0], opp, false),
        detectPinOrSkewer(afterPos, reply[0], opp, false),
        detectDeflection(after.fen, reply, opp, false),
        newTrap,
      ];
      for (const motif of replyMotifs) {
        if (motif && out.length < 2) {
          out.push(motif);
          break;
        }
      }
    }

    if (reply && out.length < 2 && !hung) {
      const lost = -materialDelta(after.fen, reply, LINE_PLIES, m.color);
      if (lost >= MATERIAL_SWING) out.push({ code: "losesMaterial", pawns: lost });
    }
    if (best && out.length < 2 && m.bestUci !== playedUci) {
      const bestStep = stepUci(beforePos, best[0]);
      const newBestTrap = bestStep
        ? isNewlyTrapped(beforePos, bestStep.pos, opposite(m.color), best[0], true)
        : null;
      const bestMotif = toMissedTactic(
        detectBackRank(before.fen, best, m.color, true) ??
          detectDiscoveryOrDoubleCheck(beforePos, best[0], m.color, true) ??
          detectPinOrSkewer(beforePos, best[0], m.color, true) ??
          detectDeflection(before.fen, best, m.color, true) ??
          newBestTrap,
      );
      const won = materialDelta(before.fen, best, LINE_PLIES + 1, m.color);
      if (won >= MATERIAL_SWING) out.push({ code: "bestWinsMaterial", pawns: won });
      else if (bestMotif) out.push(bestMotif);
    }
  } else if (out.length < 2) {
    // Standout / good move: report tactical motif executed by the played move.
    const beforePos = positionFromFen(before.fen);
    const playedSeq = [playedUci, ...(reply ?? [])];
    const newOppTrap = isNewlyTrapped(beforePos, afterPos, opposite(m.color), playedUci, true);
    const goodMotif =
      detectBackRank(before.fen, playedSeq, m.color, true) ??
      detectDiscoveryOrDoubleCheck(beforePos, playedUci, m.color, true) ??
      detectPinOrSkewer(beforePos, playedUci, m.color, true) ??
      detectDeflection(before.fen, playedSeq, m.color, true) ??
      newOppTrap;
    if (goodMotif) out.push(goodMotif);
  }

  if (out.length === 0) {
    const from = outlook(m.winBefore);
    const to = outlook(m.winAfter);
    if (from !== to && cls !== "best" && cls !== "excellent") out.push({ code: "swing", from, to });
    else if (cls === "best" && previous && isError(previous)) out.push({ code: "punishes" });
  }
  return out.slice(0, 2);
}

function isError(m: MoveReview): boolean {
  return m.classification === "mistake" || m.classification === "blunder" || m.classification === "miss";
}
