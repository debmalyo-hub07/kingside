// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  classifyMove,
  type EngineLine,
  type GameTree,
  type MoveClass,
  type MoveNode,
  positionFromFen,
  type Score,
} from "@kingside/chess-core";

export interface EvalEntry {
  depth: number;
  lines: EngineLine[];
}

export function epdOf(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export function collectTreeNodes(root: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  const stack: MoveNode[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    out.push(cur);
    for (let i = cur.children.length - 1; i >= 0; i--) {
      const child = cur.children[i];
      if (child) stack.push(child);
    }
  }
  return out;
}

export function isBetterEvalEntry(current: EvalEntry | undefined, next: EvalEntry): boolean {
  if (next.lines.length === 0) return false;
  if (!current || current.lines.length === 0) return true;
  if (next.depth !== current.depth) return next.depth > current.depth;
  return next.lines.length > current.lines.length;
}

function sameScore(a: Score | undefined, b: Score | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.cp === b.cp && a.mate === b.mate;
}

export function shouldUpdateEvalEntry(
  current: EvalEntry | undefined,
  next: EvalEntry,
  done: boolean,
): boolean {
  if (next.lines.length === 0) return false;
  if (!current || current.lines.length === 0) return true;
  if (next.depth < current.depth) return false;
  if (next.depth === current.depth) {
    if (next.lines.length > current.lines.length) return true;
    if (next.lines.length < current.lines.length) return false;
    if (next.lines[0]?.pv[0] !== current.lines[0]?.pv[0]) return true;
    if (!sameScore(current.lines[0]?.score, next.lines[0]?.score)) return true;
    if (!sameScore(current.lines[1]?.score, next.lines[1]?.score)) return true;
    return false;
  }
  if (done) return true;
  if (next.lines[0]?.pv[0] !== current.lines[0]?.pv[0]) return true;
  if (!sameScore(current.lines[0]?.score, next.lines[0]?.score)) return true;
  if (!sameScore(current.lines[1]?.score, next.lines[1]?.score)) return true;
  return next.depth >= current.depth + 4;
}

/**
 * Resolves classifications across every node in `tree`:
 * - Anchored Match Analysis classifications (`reviewClasses[node.id]`) are preserved verbatim.
 * - Explored / newly analyzed moves without an anchored classification are classified live
 *   via `classifyMove` whenever both before and after evaluations (or terminal after position) exist.
 */
export function computeTreeClassifications({
  tree,
  reviewClasses,
  evalMap,
}: {
  tree: GameTree;
  reviewClasses: Readonly<Record<string, MoveClass>>;
  evalMap: Readonly<Record<string, EvalEntry>>;
}): Record<string, MoveClass> {
  const result: Record<string, MoveClass> = {};

  const walk = (
    node: MoveNode,
    parent: MoveNode | undefined,
    grandparent: MoveNode | undefined,
    parentClass: MoveClass | undefined,
  ) => {
    const beforeEntry = evalMap[epdOf(node.fen)];
    const prevBeforeEntry = grandparent ? evalMap[epdOf(grandparent.fen)] : undefined;
    for (const child of node.children) {
      const anchored = reviewClasses[child.id];
      let cls: MoveClass | undefined = anchored;
      if (!cls && child.san && child.uci && beforeEntry && beforeEntry.lines.length > 0) {
        const afterEntry = evalMap[epdOf(child.fen)];
        let isTerminal = false;
        if (!afterEntry || afterEntry.lines.length === 0) {
          try {
            isTerminal = positionFromFen(child.fen).isEnd();
          } catch {
            isTerminal = false;
          }
        }
        if ((afterEntry && afterEntry.lines.length > 0) || isTerminal) {
          try {
            cls =
              classifyMove({
                before: { fen: node.fen, lines: beforeEntry.lines },
                after: { fen: child.fen, lines: afterEntry?.lines ?? [] },
                move: { san: child.san, uci: child.uci },
                ...(grandparent && prevBeforeEntry && prevBeforeEntry.lines.length > 0
                  ? { prevBefore: { fen: grandparent.fen, lines: prevBeforeEntry.lines } }
                  : {}),
                ...(parent?.san && parent?.uci ? { prevMove: { san: parent.san, uci: parent.uci } } : {}),
                ...(parentClass ? { previous: parentClass } : {}),
              }) ?? undefined;
          } catch {
            cls = undefined;
          }
        }
      }
      if (cls) result[child.id] = cls;
      walk(child, node, parent, cls);
    }
  };

  walk(tree.root, undefined, undefined, undefined);
  return result;
}
