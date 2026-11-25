// SPDX-License-Identifier: AGPL-3.0-or-later
// Drives one Stockfish worker as a bot opponent: opening variety from the book, then the
// persona's strength settings (docs/ALGORITHMS.md §9).
"use client";

import {
  addMove,
  type BotPersona,
  createTree,
  type EngineLine,
  humanLikeMistakeMove,
  nodeAtPath,
  pickBotMove,
  positionFromFen,
  type Score,
} from "@kingside/chess-core";
import { makeSquare } from "chessops/util";
import { StockfishEngine } from "@/engine/stockfish-engine";
import { loadOpenings } from "@/lib/openings";

/** Bots leave the book after this many plies (or earlier, at random). */
const BOOK_PLIES = 10;
const STAY_IN_BOOK = 0.85;

export interface BotMove {
  uci: string;
  /** Engine score of the position for the bot (White POV), when a search ran. */
  score?: Score;
}

function legalUcis(fen: string): string[] {
  const pos = positionFromFen(fen);
  const out: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) out.push(makeSquare(from) + makeSquare(to));
  }
  return out;
}

export class BotPlayer {
  private readonly engine: StockfishEngine;

  constructor() {
    // Two threads are plenty for limited strength and keep the page responsive.
    const threads = typeof window !== "undefined" && window.crossOriginIsolated ? 2 : 1;
    this.engine = new StockfishEngine({ threads, hashMb: 32, net: "lite" });
  }

  destroy(): void {
    this.engine.destroy();
  }

  private async bookMove(fen: string, ply: number, maxPlies = BOOK_PLIES): Promise<string | undefined> {
    if (ply >= maxPlies || Math.random() > STAY_IN_BOOK) return undefined;
    const data = await loadOpenings().catch(() => null);
    if (!data) return undefined;
    const tree = createTree(fen);
    const options = legalUcis(fen).filter((uci) => {
      const path = addMove(tree, [], uci);
      const after = path ? nodeAtPath(tree, path)?.fen : undefined;
      return after ? data.book.has(after.split(" ").slice(0, 4).join(" ")) : false;
    });
    return options[Math.floor(Math.random() * options.length)];
  }

  async chooseMove(
    fen: string,
    ply: number,
    bot: BotPersona,
    signal: AbortSignal,
  ): Promise<BotMove | undefined> {
    const level = bot.level;
    const book = await this.bookMove(fen, ply, level.bookPlies ?? BOOK_PLIES);
    if (book) return { uci: book };

    const mover = positionFromFen(fen).turn;
    if (level.method === "sample") {
      this.engine.setOption("UCI_LimitStrength", false);
      this.engine.setOption("Skill Level", level.skill ?? 0);
      const snap = await this.engine.evaluate(
        fen,
        { depth: level.depth ?? 4, multiPv: level.multiPv ?? 4 },
        signal,
      );
      const lines: EngineLine[] = snap.lines.map((l) => ({ pv: l.pv, score: l.score, depth: l.depth }));
      const uci = pickBotMove(lines, mover, level);
      const score = lines[0]?.score;
      return uci ? { uci, ...(score ? { score } : {}) } : undefined;
    }
    if (level.randomMoveChance && Math.random() < level.randomMoveChance) {
      const mistake = humanLikeMistakeMove(fen);
      if (mistake) return { uci: mistake };
    }
    this.engine.setOption("Skill Level", 20);
    this.engine.setOption("UCI_LimitStrength", level.method === "limit");
    if (level.method === "limit") this.engine.setOption("UCI_Elo", level.engineElo ?? level.elo);
    const snap = await this.engine.evaluate(
      fen,
      { depth: null, movetimeMs: level.movetimeMs ?? 500, multiPv: 1 },
      signal,
    );
    const line = snap.lines[0];
    return line?.pv[0] ? { uci: line.pv[0], score: line.score } : undefined;
  }

  /** Full-strength suggestion for the human player. */
  async hint(fen: string, signal: AbortSignal): Promise<string | undefined> {
    this.engine.setOption("UCI_LimitStrength", false);
    this.engine.setOption("Skill Level", 20);
    const snap = await this.engine.evaluate(fen, { depth: 16, movetimeMs: 1500, multiPv: 1 }, signal);
    return snap.lines[0]?.pv[0];
  }
}
