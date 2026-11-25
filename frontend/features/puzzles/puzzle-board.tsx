// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen } from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import type { PuzzleState } from "./use-puzzle";

const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;

/** Interactive board for a puzzle session (from usePuzzle). */
export function PuzzleBoard({ state }: { state: PuzzleState }) {
  const api = useRef<Api | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const pos = useMemo(() => (state.fen ? positionFromFen(state.fen) : null), [state.fen]);
  const dests = useMemo(
    () =>
      pos && state.canMove && !promotion ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map<Key, Key[]>(),
    [pos, state.canMove, promotion],
  );

  // A rejected move leaves the piece where it was dropped: put the board back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new mistake.
  useEffect(() => {
    api.current?.set({ fen: state.fen });
  }, [state.mistakes]);

  if (!pos) return <div className="aspect-square w-full animate-pulse rounded-md bg-secondary" />;

  const lastMove = state.lastMove
    ? ([state.lastMove.slice(0, 2), state.lastMove.slice(2, 4)] as Key[])
    : undefined;

  return (
    <ChessBoard
      sound
      fen={state.fen}
      orientation={state.color}
      turnColor={pos.turn}
      lastMove={lastMove}
      check={pos.isCheck()}
      dests={dests}
      onReady={(a) => {
        api.current = a;
      }}
      onMove={(orig, dest) => {
        const sq = (orig.charCodeAt(1) - 49) * 8 + (orig.charCodeAt(0) - 97);
        const piece = pos.board.get(sq);
        if (piece?.role === "pawn" && (dest[1] === "8" || dest[1] === "1")) {
          setPromotion({ orig, dest });
          return;
        }
        state.play(orig + dest);
      }}
    >
      {promotion && (
        <PromotionPicker
          color={pos.turn}
          onPick={(role) => {
            state.play(promotion.orig + promotion.dest + ROLE_CHAR[role]);
            setPromotion(null);
          }}
          onCancel={() => {
            setPromotion(null);
            api.current?.set({ fen: state.fen });
          }}
        />
      )}
    </ChessBoard>
  );
}
