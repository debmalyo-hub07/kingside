// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds a ShareDialog target from a PGN (library rows, finished bot games).

import { mainlineFrom, nodesAlongPath, treeFromPgn } from "@kingside/chess-core";
import type { ShareTarget } from "./share-dialog";

export function shareTargetFromPgn(
  pgn: string,
  opts: { orientation?: "white" | "black"; ply?: number } = {},
): ShareTarget {
  const tree = treeFromPgn(pgn);
  const nodes = nodesAlongPath(tree, mainlineFrom(tree));
  const ply = Math.min(opts.ply ?? nodes.length - 1, nodes.length - 1);
  const node = nodes[ply] ?? tree.root;
  const h = (k: string) => {
    const v = tree.headers.get(k);
    return v && v !== "?" ? v : undefined;
  };
  return {
    pgn,
    fens: nodes.map((n) => n.fen),
    moves: nodes.slice(1).map((n) => n.uci ?? ""),
    ply,
    fen: node.fen,
    lastMove: node.uci,
    orientation: opts.orientation ?? "white",
    analysis: null,
    white: h("White"),
    black: h("Black"),
    date: h("Date") ?? null,
  };
}
