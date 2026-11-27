// SPDX-License-Identifier: AGPL-3.0-or-later

import { type GameTree, type MoveNode, nodesAlongPath, positionFromFen } from "@kingside/chess-core";

export interface PlayMoveCell {
  plyIndex: number;
  san: string;
  color: "white" | "black";
}

export interface PlayMoveRow {
  moveNo: number;
  white?: PlayMoveCell;
  black?: PlayMoveCell;
}

/** Builds 2-column move rows along the current path, supporting both standard and Black-to-move FENs. */
export function buildPlayHistoryRows(
  tree: GameTree,
  path: string[],
): {
  nodes: MoveNode[];
  rows: PlayMoveRow[];
} {
  const nodes = nodesAlongPath(tree, path);
  const rows: PlayMoveRow[] = [];

  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    if (!prev || !curr) continue;
    const before = positionFromFen(prev.fen);
    const color = before.turn;
    const moveNo = before.fullmoves;
    const cell: PlayMoveCell = { plyIndex: i, san: curr.san ?? curr.uci ?? "", color };

    if (color === "white") {
      rows.push({ moveNo, white: cell });
    } else {
      const last = rows.at(-1);
      if (last?.white && !last.black) {
        last.black = cell;
      } else {
        rows.push({ moveNo, black: cell });
      }
    }
  }

  return { nodes, rows };
}

/** Resolves live vs previewed ply without mutating the underlying GameTree. */
export function resolvePlayView(nodes: readonly MoveNode[], root: MoveNode, viewPly: number | null) {
  const livePly = Math.max(0, nodes.length - 1);
  const effectivePly = viewPly === null ? livePly : Math.max(0, Math.min(viewPly, livePly));
  const viewingHistory = effectivePly < livePly;
  const liveNode = nodes[livePly] ?? root;
  const shownNode = nodes[effectivePly] ?? root;
  return { livePly, effectivePly, viewingHistory, liveNode, shownNode };
}
