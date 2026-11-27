// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { mainlineFrom, nodesAlongPath, positionFromFen, treeFromPgn } from "@kingside/chess-core";
import { memo, useId, useMemo } from "react";
import { boardTheme } from "@/lib/board-themes";
import { pieceUrl } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

export interface FinalPositionInfo {
  fen: string;
  lastMove?: [string, string];
}

/** Extracts the final mainline FEN and last move squares from a PGN, or null if malformed/empty. */
export function extractFinalPositionFromPgn(pgn: string): FinalPositionInfo | null {
  if (!pgn.trim()) return null;
  try {
    const tree = treeFromPgn(pgn);
    const nodes = nodesAlongPath(tree, mainlineFrom(tree));
    if (nodes.length < 2 && !tree.headers.has("FEN")) return null;
    const last = nodes[nodes.length - 1];
    if (!last?.fen) return null;
    const uci = last.uci;
    const lastMove =
      uci && uci.length >= 4 ? ([uci.slice(0, 2), uci.slice(2, 4)] as [string, string]) : undefined;
    return { fen: last.fen, lastMove };
  } catch {
    return null;
  }
}

interface MiniBoardProps {
  pgn?: string;
  fen?: string;
  lastMove?: [string, string];
  label: string;
  orientation?: "white" | "black";
  boardThemeId?: string;
  pieceSetId?: string;
  className?: string;
}

const FILES = "abcdefgh";

/** Lightweight pure-SVG 8×8 position thumbnail (zero Chessground DOM/WebGL overhead). */
export const MiniBoard = memo(function MiniBoard({
  pgn,
  fen,
  lastMove,
  label,
  orientation = "white",
  boardThemeId,
  pieceSetId,
  className,
}: MiniBoardProps) {
  const settingsTheme = useSettings((s) => s.boardTheme);
  const settingsPieces = useSettings((s) => s.pieceSet);
  const theme = boardTheme(boardThemeId ?? settingsTheme);
  const pieces = pieceSetId ?? settingsPieces;
  const clipId = useId();

  const resolved = useMemo(() => {
    if (fen) return { fen, lastMove };
    if (pgn) return extractFinalPositionFromPgn(pgn);
    return null;
  }, [fen, pgn, lastMove]);

  const pos = useMemo(() => {
    if (!resolved?.fen) return null;
    try {
      return positionFromFen(resolved.fen);
    } catch {
      return null;
    }
  }, [resolved?.fen]);

  const lastSet = useMemo(() => new Set(resolved?.lastMove ?? []), [resolved?.lastMove]);

  const squares = [];
  const pieceNodes = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = orientation === "white" ? 7 - row : row;
      const file = orientation === "white" ? col : 7 - col;
      const sqIndex = rank * 8 + file;
      const sqName = `${FILES[file]}${rank + 1}`;
      const isLight = (rank + file) % 2 === 1;
      const x = col * 10;
      const y = row * 10;

      squares.push(
        <rect
          key={sqName}
          x={x}
          y={y}
          width={10}
          height={10}
          fill={isLight ? theme.light : theme.dark}
          shapeRendering="crispEdges"
        />,
      );

      if (lastSet.has(sqName)) {
        squares.push(
          <rect
            key={`${sqName}-last`}
            x={x}
            y={y}
            width={10}
            height={10}
            fill={theme.lastMove}
            shapeRendering="crispEdges"
          />,
        );
      }

      const piece = pos?.board.get(sqIndex);
      if (piece) {
        pieceNodes.push(
          <image
            key={`${sqName}-piece`}
            href={pieceUrl(pieces, piece.color, piece.role)}
            x={x + 0.4}
            y={y + 0.4}
            width={9.2}
            height={9.2}
          />,
        );
      }
    }
  }

  return (
    <svg
      viewBox="0 0 80 80"
      role="img"
      aria-label={label}
      data-mini-board={pos ? "ready" : "fallback"}
      className={cn("block aspect-square overflow-hidden rounded-lg", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="80" height="80" rx="6" ry="6" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {squares}
        {pieceNodes}
      </g>
    </svg>
  );
});
