// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside's own practice set: classic positions (chess facts, public domain) with our own titles and texts.
// Every goal is checked by scripts/check-practice.mts (tablebase for ≤ 7 pieces, Stockfish otherwise).
// Text lives in messages/en.json under practice.positions.<id> (title, text).

import type { PracticeGoal } from "@kingside/chess-core";
import type messages from "@/messages/en.json";

/** Ids are the message keys of the texts, so a missing text is a type error. */
export type PracticeId = keyof (typeof messages)["practice"]["positions"];

export interface PracticePosition {
  id: PracticeId;
  fen: string;
  goal: PracticeGoal;
  /** 1 = beginner … 3 = advanced */
  level: 1 | 2 | 3;
}

export interface PracticeSection {
  id: "mates" | "patterns" | "tactics" | "pawns" | "endgames" | "defence";
  positions: PracticePosition[];
}

export const PRACTICE_SECTIONS: PracticeSection[] = [
  {
    id: "mates",
    positions: [
      { id: "queen-mate", fen: "8/8/8/4k3/8/8/8/3QK3 w - - 0 1", goal: { kind: "mate" }, level: 1 },
      { id: "two-rooks", fen: "8/8/4k3/8/8/8/8/R3K2R w - - 0 1", goal: { kind: "mate" }, level: 1 },
      { id: "rook-mate", fen: "8/8/8/4k3/8/8/8/R3K3 w - - 0 1", goal: { kind: "mate" }, level: 2 },
      { id: "two-bishops", fen: "8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1", goal: { kind: "mate" }, level: 3 },
      { id: "bishop-knight", fen: "8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1", goal: { kind: "mate" }, level: 3 },
    ],
  },
  {
    id: "patterns",
    positions: [
      {
        id: "back-rank",
        fen: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
        goal: { kind: "mate", moves: 1 },
        level: 1,
      },
      {
        id: "smothered",
        fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1",
        goal: { kind: "mate", moves: 1 },
        level: 1,
      },
      { id: "arabian", fen: "7k/1R6/5N2/8/8/8/8/6K1 w - - 0 1", goal: { kind: "mate", moves: 1 }, level: 1 },
      {
        id: "scholars",
        fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
        goal: { kind: "mate", moves: 1 },
        level: 1,
      },
      { id: "ladder", fen: "6k1/8/8/8/8/8/R7/1R4K1 w - - 0 1", goal: { kind: "mate", moves: 2 }, level: 1 },
      {
        id: "legal",
        fen: "rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P3/2N5/PPPP1PPP/R1BbK2R w KQkq - 0 6",
        goal: { kind: "mate", moves: 2 },
        level: 2,
      },
      {
        id: "anastasia",
        fen: "5r1k/4Nppp/8/8/7Q/4R3/5PPP/6K1 w - - 0 1",
        goal: { kind: "mate", moves: 2 },
        level: 2,
      },
      {
        id: "philidor-legacy",
        fen: "3r3k/6pp/8/4N3/2Q5/8/5PPP/6K1 w - - 0 1",
        goal: { kind: "mate", moves: 4 },
        level: 3,
      },
    ],
  },
  {
    id: "tactics",
    positions: [
      {
        id: "knight-fork",
        fen: "q3k3/8/8/1N6/8/8/5PPP/6K1 w - - 0 1",
        goal: { kind: "advantage", cp: 500, moves: 2 },
        level: 1,
      },
      {
        id: "skewer",
        fen: "2q5/8/8/2k5/8/8/8/K6R w - - 0 1",
        goal: { kind: "advantage", cp: 500, moves: 2 },
        level: 1,
      },
      {
        id: "discovered",
        fen: "4k3/1q6/8/8/4N3/8/8/4RK2 w - - 0 1",
        goal: { kind: "advantage", cp: 500, moves: 2 },
        level: 2,
      },
    ],
  },
  {
    id: "pawns",
    positions: [
      { id: "opposition", fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1", goal: { kind: "promote" }, level: 1 },
      { id: "key-squares", fen: "8/8/8/4k3/8/8/3KP3/8 w - - 0 1", goal: { kind: "promote" }, level: 2 },
      { id: "square", fen: "8/8/8/8/p7/8/8/4K2k w - - 0 1", goal: { kind: "draw", moves: 6 }, level: 1 },
      { id: "breakthrough", fen: "7k/ppp5/8/PPP5/8/8/8/7K w - - 0 1", goal: { kind: "promote" }, level: 3 },
    ],
  },
  {
    id: "endgames",
    positions: [
      { id: "rook-cut", fen: "8/8/3k4/8/8/2K5/8/7R w - - 0 1", goal: { kind: "mate" }, level: 2 },
      { id: "queen-vs-pawn", fen: "8/8/8/8/8/8/1pk5/4K2Q w - - 0 1", goal: { kind: "mate" }, level: 2 },
      { id: "lucena", fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1", goal: { kind: "promote" }, level: 3 },
    ],
  },
  {
    id: "defence",
    positions: [
      {
        id: "philidor",
        fen: "4k3/7R/r7/4PK2/8/8/8/8 b - - 0 1",
        goal: { kind: "draw", moves: 10 },
        level: 3,
      },
      {
        id: "king-in-front",
        fen: "8/8/8/8/4k3/8/4PK2/8 b - - 0 1",
        goal: { kind: "draw", moves: 8 },
        level: 2,
      },
      {
        id: "wrong-bishop",
        fen: "7k/8/6K1/7P/8/8/2B5/8 b - - 0 1",
        goal: { kind: "draw", moves: 8 },
        level: 2,
      },
      { id: "rook-pawn", fen: "k7/8/1K6/P7/8/8/8/8 b - - 0 1", goal: { kind: "draw", moves: 8 }, level: 1 },
    ],
  },
];

export const ALL_PRACTICE = PRACTICE_SECTIONS.flatMap((s) =>
  s.positions.map((p) => ({ ...p, section: s.id })),
);

export function practiceById(id: string) {
  return ALL_PRACTICE.find((p) => p.id === id);
}
