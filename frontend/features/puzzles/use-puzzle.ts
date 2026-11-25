// SPDX-License-Identifier: AGPL-3.0-or-later
// Plays one puzzle: the opponent's setup move, then checks each solver move and answers with the
// next solution move. A different move that gives checkmate is also accepted (any mate is a solution).
"use client";

import {
  addMove,
  createTree,
  type GameTree,
  nodeAtPath,
  positionFromFen,
  uciLineToSan,
} from "@kingside/chess-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { playSound } from "@/lib/sounds";
import type { Puzzle } from "./puzzle-data";

export type PuzzleStatus = "loading" | "playing" | "wrong" | "solved" | "failed";

const SETUP_DELAY_MS = 500;
const REPLY_DELAY_MS = 350;

export interface PuzzleState {
  fen: string;
  lastMove: string | undefined;
  status: PuzzleStatus;
  /** Side the solver plays. */
  color: "white" | "black";
  /** True once any wrong move was made (the puzzle then counts as failed). */
  hadMistake: boolean;
  mistakes: number;
  /** Solver's turn and input allowed. */
  canMove: boolean;
  play: (uci: string) => void;
  showSolution: () => void;
}

function sameMove(fen: string, a: string, b: string): boolean {
  const [sa] = uciLineToSan(fen, [a]);
  const [sb] = uciLineToSan(fen, [b]);
  return sa !== undefined && sa === sb;
}

/**
 * @param onResult called once per puzzle: with `true` if solved without a mistake, `false` at the first mistake.
 */
export function usePuzzle(puzzle: Puzzle | null, onResult: (solvedClean: boolean) => void): PuzzleState {
  const tree = useRef<GameTree | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<PuzzleStatus>("loading");
  const [mistakes, setMistakes] = useState(0);
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const report = (clean: boolean) => {
    if (reported.current) return;
    reported.current = true;
    resultRef.current(clean);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the puzzle changes.
  useEffect(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    reported.current = false;
    setMistakes(0);
    setStep(0);
    setPath([]);
    if (!puzzle) {
      tree.current = null;
      setStatus("loading");
      return;
    }
    tree.current = createTree(puzzle.fen);
    setStatus("loading");
    later(() => {
      const t = tree.current;
      const setup = puzzle.moves[0];
      const next = t && setup ? addMove(t, [], setup) : undefined;
      if (next) {
        setPath(next);
        setStep(1);
        setStatus("playing");
      }
    }, SETUP_DELAY_MS);
    return () => {
      for (const t of timers.current) clearTimeout(t);
    };
  }, [puzzle]);

  const node = tree.current ? nodeAtPath(tree.current, path) : undefined;
  const fen = node?.fen ?? puzzle?.fen ?? "";
  const color: "white" | "black" = puzzle
    ? positionFromFen(puzzle.fen).turn === "white"
      ? "black"
      : "white"
    : "white";

  // biome-ignore lint/correctness/useExhaustiveDependencies: later/report only touch refs.
  const play = useCallback(
    (uci: string) => {
      const t = tree.current;
      if (!t || !puzzle || (status !== "playing" && status !== "wrong")) return;
      const expected = puzzle.moves[step];
      if (!expected) return;
      const next = addMove(t, path, uci);
      if (!next) return;
      const afterFen = nodeAtPath(t, next)?.fen ?? "";
      const correct = sameMove(fen, uci, expected) || positionFromFen(afterFen).isCheckmate();
      if (!correct) {
        setMistakes((m) => m + 1);
        setStatus("wrong");
        playSound("wrong");
        report(false);
        return;
      }
      setPath(next);
      const reply = puzzle.moves[step + 1];
      if (!reply || positionFromFen(afterFen).isCheckmate()) {
        setStep(puzzle.moves.length);
        setStatus(mistakes > 0 ? "failed" : "solved");
        if (mistakes === 0) playSound("correct");
        report(true);
        return;
      }
      setStatus("playing");
      setStep(step + 1);
      later(() => {
        const withReply = addMove(t, next, reply);
        if (withReply) setPath(withReply);
        setStep(step + 2);
        if (step + 2 >= puzzle.moves.length) {
          setStatus(mistakes > 0 ? "failed" : "solved");
          if (mistakes === 0) playSound("correct");
          report(true);
        }
      }, REPLY_DELAY_MS);
    },
    [puzzle, status, step, path, fen, mistakes],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: later/report only touch refs.
  const showSolution = useCallback(() => {
    const t = tree.current;
    if (!t || !puzzle) return;
    report(false);
    let p = path;
    puzzle.moves.slice(step).forEach((uci, i) => {
      later(
        () => {
          const next = addMove(t, p, uci);
          if (next) {
            p = next;
            setPath(next);
          }
          if (step + i + 1 >= puzzle.moves.length) setStatus("failed");
        },
        (i + 1) * 500,
      );
    });
    setStatus("failed");
  }, [puzzle, path, step]);

  const solverToMove = puzzle ? positionFromFen(fen).turn === color : false;
  return {
    fen,
    lastMove: node?.uci,
    status,
    color,
    hadMistake: mistakes > 0,
    mistakes,
    canMove: (status === "playing" || status === "wrong") && solverToMove,
    play,
    showSolution,
  };
}
