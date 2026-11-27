// SPDX-License-Identifier: AGPL-3.0-or-later
// Plays one puzzle: the opponent's setup move, then checks each solver move and answers with the
// next solution move. A different move that gives checkmate is also accepted (any mate is a solution).
"use client";

import { addMove, createTree, type GameTree, nodeAtPath, positionFromFen } from "@kingside/chess-core";
import type { Key } from "chessground/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playSound } from "@/lib/sounds";
import type { Puzzle } from "./puzzle-data";
import {
  buildPuzzleHistory,
  evaluatePuzzleAttempt,
  type PuzzleHistoryStep,
  puzzleHintSquare,
  resolvePuzzleStep,
} from "./puzzle-logic";

export type PuzzleStatus = "loading" | "playing" | "wrong" | "solved" | "failed";
export type { PuzzleHistoryStep };

export interface RestoredPuzzleProgress {
  puzzleId: string;
  step: number;
  mistakes: number;
  status: PuzzleStatus;
  reported: boolean;
  pathMoves: string[];
}

export interface UsePuzzleOptions {
  restored?: RestoredPuzzleProgress | null;
  onProgressChange?: (progress: RestoredPuzzleProgress) => void;
}

const SETUP_DELAY_MS = 500;
const REPLY_DELAY_MS = 350;
const REPLAY_INTERVAL_MS = 600;

export interface PuzzleState {
  fen: string;
  liveFen: string;
  lastMove: string | undefined;
  status: PuzzleStatus;
  /** Side the solver plays. */
  color: "white" | "black";
  /** True once any wrong move was made (the puzzle then counts as failed). */
  hadMistake: boolean;
  mistakes: number;
  /** Piece starting square highlighted by learner-friendly Hint (cleared on next move). */
  hintSquare: Key | null;
  /** Played moves along the puzzle line so far. */
  history: PuzzleHistoryStep[];
  /** Currently viewed step index (0..liveStep). */
  viewStep: number;
  liveStep: number;
  viewingHistory: boolean;
  replaying: boolean;
  /** Solver's turn and input allowed. */
  canMove: boolean;
  play: (uci: string) => void;
  requestHint: () => void;
  showSolution: () => void;
  goToStep: (step: number | null) => void;
  toggleReplay: () => void;
}

/**
 * @param onResult called once per puzzle: with `true` if solved without a mistake, `false` at the first mistake.
 * Learner-friendly Hint highlights only the piece's starting square and still allows a clean (`true`) solve.
 */
export function usePuzzle(
  puzzle: Puzzle | null,
  onResult: (solvedClean: boolean) => void,
  options?: UsePuzzleOptions,
): PuzzleState {
  const tree = useRef<GameTree | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<PuzzleStatus>("loading");
  const [mistakes, setMistakes] = useState(0);
  const [hintSquare, setHintSquare] = useState<Key | null>(null);
  const [viewStep, setViewStep] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const restoredRef = useRef(options?.restored);
  restoredRef.current = options?.restored;
  const progressCbRef = useRef(options?.onProgressChange);
  progressCbRef.current = options?.onProgressChange;

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
    setHintSquare(null);
    setViewStep(null);
    setReplaying(false);
    if (!puzzle) {
      tree.current = null;
      setStatus("loading");
      return;
    }
    const restored = restoredRef.current;
    if (restored && restored.puzzleId === puzzle.id && restored.pathMoves.length > 0) {
      const t = createTree(puzzle.fen);
      let p: string[] = [];
      let valid = true;
      for (const uci of restored.pathMoves) {
        const next = addMove(t, p, uci);
        if (!next) {
          valid = false;
          break;
        }
        p = next;
      }
      if (valid) {
        tree.current = t;
        reported.current = restored.reported;
        const restoredStatus = restored.status === "loading" ? "playing" : restored.status;
        setPath(p);
        setStep(restored.step);
        setMistakes(restored.mistakes);
        setStatus(restoredStatus);
        // If reloaded mid-reply (solver moved, opponent reply still pending), schedule the opponent reply.
        if (
          restoredStatus === "playing" &&
          restored.step > 0 &&
          restored.step % 2 === 0 &&
          restored.step < puzzle.moves.length
        ) {
          const replyUci = puzzle.moves[restored.step];
          const nextStep = restored.step + 1;
          const priorMistakes = restored.mistakes;
          if (replyUci) {
            later(() => {
              const withReply = addMove(t, p, replyUci);
              if (withReply) setPath(withReply);
              setStep(nextStep);
              if (nextStep >= puzzle.moves.length) {
                setStatus(priorMistakes > 0 ? "failed" : "solved");
                if (priorMistakes === 0) playSound("correct");
                report(priorMistakes === 0);
              }
            }, REPLY_DELAY_MS);
          }
        }
        return () => {
          for (const timer of timers.current) clearTimeout(timer);
        };
      }
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: tree.current is synchronized with path.
  const history = useMemo(() => buildPuzzleHistory(tree.current, path), [path, puzzle]);

  useEffect(() => {
    if (!puzzle || status === "loading") return;
    progressCbRef.current?.({
      puzzleId: puzzle.id,
      step,
      mistakes,
      status,
      reported: reported.current,
      pathMoves: history.map((h) => h.uci),
    });
  }, [puzzle, step, mistakes, status, history]);
  const view = useMemo(
    () => resolvePuzzleStep(tree.current, path, puzzle?.fen ?? "", viewStep),
    [path, puzzle, viewStep],
  );

  const color: "white" | "black" = puzzle
    ? positionFromFen(puzzle.fen).turn === "white"
      ? "black"
      : "white"
    : "white";

  const liveSolverToMove = puzzle && view.liveFen ? positionFromFen(view.liveFen).turn === color : false;

  // Replay timer when user activates "Replay moves" after completing a puzzle.
  useEffect(() => {
    if (!replaying) return;
    if (view.liveStep === 0) {
      setReplaying(false);
      return;
    }
    const cur = viewStep === null ? 0 : viewStep;
    const id = setTimeout(() => {
      const next = cur + 1;
      if (next >= view.liveStep) {
        setReplaying(false);
        setViewStep(null);
      } else {
        setViewStep(next);
      }
    }, REPLAY_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [replaying, viewStep, view.liveStep]);

  const goToStep = useCallback(
    (target: number | null) => {
      setReplaying(false);
      if (target === null || target >= view.liveStep) {
        setViewStep(null);
      } else {
        setViewStep(Math.max(0, target));
      }
    },
    [view.liveStep],
  );

  const toggleReplay = useCallback(() => {
    if (view.liveStep === 0) return;
    if (replaying) {
      setReplaying(false);
    } else {
      setViewStep(0);
      setReplaying(true);
    }
  }, [replaying, view.liveStep]);

  const requestHint = useCallback(() => {
    if (!puzzle || (status !== "playing" && status !== "wrong") || !liveSolverToMove || view.viewingHistory) {
      return;
    }
    const sq = puzzleHintSquare(puzzle.moves, step);
    if (sq) setHintSquare(sq);
  }, [puzzle, status, liveSolverToMove, view.viewingHistory, step]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: later/report only touch refs.
  const play = useCallback(
    (uci: string) => {
      const t = tree.current;
      if (!t || !puzzle || (status !== "playing" && status !== "wrong") || view.viewingHistory) return;
      const expected = puzzle.moves[step];
      if (!expected) return;
      const next = addMove(t, path, uci);
      if (!next) return;
      setHintSquare(null);
      setViewStep(null);
      setReplaying(false);
      const afterFen = nodeAtPath(t, next)?.fen ?? "";
      const outcome = evaluatePuzzleAttempt({
        fen: view.liveFen,
        expected,
        played: uci,
        afterFen,
        currentMistakes: mistakes,
        nextReply: puzzle.moves[step + 1],
        step,
      });
      if (outcome.kind === "wrong") {
        setMistakes(outcome.mistakes);
        setStatus(outcome.status);
        playSound("wrong");
        report(outcome.reportClean);
        return;
      }
      setPath(next);
      if (outcome.kind === "complete") {
        setStep(puzzle.moves.length);
        setStatus(outcome.status);
        if (outcome.reportClean) playSound("correct");
        report(outcome.reportClean);
        return;
      }
      setStatus("playing");
      setStep(outcome.nextStep);
      later(() => {
        const withReply = addMove(t, next, outcome.replyUci);
        if (withReply) setPath(withReply);
        setStep(step + 2);
        if (step + 2 >= puzzle.moves.length) {
          setStatus(mistakes > 0 ? "failed" : "solved");
          if (mistakes === 0) playSound("correct");
          report(mistakes === 0);
        }
      }, REPLY_DELAY_MS);
    },
    [puzzle, status, step, path, view.liveFen, view.viewingHistory, mistakes],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: later/report only touch refs.
  const showSolution = useCallback(() => {
    const t = tree.current;
    if (!t || !puzzle) return;
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    setHintSquare(null);
    setViewStep(null);
    setReplaying(false);
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

  return {
    fen: view.shownFen,
    liveFen: view.liveFen,
    lastMove: view.shownNode?.uci,
    status,
    color,
    hadMistake: mistakes > 0,
    mistakes,
    hintSquare: view.viewingHistory ? null : hintSquare,
    history,
    viewStep: view.effectiveStep,
    liveStep: view.liveStep,
    viewingHistory: view.viewingHistory,
    replaying,
    canMove: (status === "playing" || status === "wrong") && liveSolverToMove && !view.viewingHistory,
    play,
    requestHint,
    showSolution,
    goToStep,
    toggleReplay,
  };
}
