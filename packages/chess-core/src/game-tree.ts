// SPDX-License-Identifier: AGPL-3.0-or-later
// Move tree with variations, PGN import/export. Nodes are mutated in place; callers
// that need change detection (React stores) track their own version counter.

import { Chess, normalizeMove } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import {
  ChildNode,
  defaultGame,
  type Game,
  makePgn,
  type Node,
  type PgnNodeData,
  parsePgn,
  startingPosition,
} from "chessops/pgn";
import { makeSanAndPlay, parseSan } from "chessops/san";
import type { Move } from "chessops/types";
import { makeUci, parseUci } from "chessops/util";

export interface MoveNode {
  /** Unique within its tree. */
  id: string;
  /** 0 at the root position. */
  ply: number;
  /** Position after this node's move (root: starting position). */
  fen: string;
  /** Move that led here; undefined only for the root. */
  san?: string;
  uci?: string;
  comments: string[];
  nags: number[];
  /** children[0] is the main continuation, the rest are variations. */
  children: MoveNode[];
}

export interface GameTree {
  root: MoveNode;
  headers: Map<string, string>;
  nextId: number;
}

/** Path from the root: ids of the nodes below the root, in order. Empty path = root. */
export type TreePath = readonly string[];

/** Machine-readable reason, for translated messages in the UI (the English message stays as `message`). */
export type InvalidPositionCode =
  | "ERR_FEN"
  | "ERR_BOARD"
  | "ERR_POCKETS"
  | "ERR_TURN"
  | "ERR_CASTLING"
  | "ERR_EP_SQUARE"
  | "ERR_HALFMOVES"
  | "ERR_FULLMOVES"
  | "ERR_EMPTY"
  | "ERR_KINGS"
  | "ERR_OPPOSITE_CHECK"
  | "ERR_PAWNS_ON_BACKRANK"
  | "ERR_IMPOSSIBLE_CHECK"
  | "ERR_VARIANT"
  | "ERR_ILLEGAL"
  | "ERR_NO_GAME"
  | "ERR_PGN_START"
  | "ERR_NO_MOVES"
  | "ERR_TOO_SHORT";

export class InvalidPositionError extends Error {
  constructor(
    message: string,
    readonly code: InvalidPositionCode = "ERR_ILLEGAL",
  ) {
    super(message);
  }
}

function positionError(
  raw: string,
  fallback: InvalidPositionCode,
  fallbackText: string,
): InvalidPositionError {
  const known = raw in ERROR_MESSAGES ? (raw as InvalidPositionCode) : null;
  return new InvalidPositionError(
    known ? (ERROR_MESSAGES[known] as string) : fallbackText,
    known ?? fallback,
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  ERR_FEN: "Invalid FEN",
  ERR_BOARD: "Invalid FEN: board part is malformed",
  ERR_POCKETS: "Invalid FEN: pockets are not supported",
  ERR_TURN: "Invalid FEN: side to move must be w or b",
  ERR_CASTLING: "Invalid FEN: castling field is malformed",
  ERR_EP_SQUARE: "Invalid FEN: en passant square is malformed",
  ERR_HALFMOVES: "Invalid FEN: halfmove clock is malformed",
  ERR_FULLMOVES: "Invalid FEN: move number is malformed",
  ERR_EMPTY: "The board is empty",
  ERR_KINGS: "Each side needs exactly one king",
  ERR_OPPOSITE_CHECK: "The side not to move is in check",
  ERR_PAWNS_ON_BACKRANK: "Pawns cannot stand on the first or last rank",
  ERR_IMPOSSIBLE_CHECK: "This check could not happen in a real game",
  ERR_VARIANT: "Position is not valid for standard chess",
};

/** Parses a FEN into a legal standard-chess position, or throws InvalidPositionError with a readable message. */
export function positionFromFen(fen: string): Chess {
  const setup = parseFen(fen.trim());
  if (setup.isErr) throw positionError(setup.error.message, "ERR_FEN", "Invalid FEN");
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) throw positionError(pos.error.message, "ERR_ILLEGAL", "Illegal position");
  return pos.value;
}

function newNode(tree: GameTree, fields: Omit<MoveNode, "id" | "children" | "comments" | "nags">): MoveNode {
  return { id: `n${tree.nextId++}`, comments: [], nags: [], children: [], ...fields };
}

export function createTree(fen: string = INITIAL_FEN): GameTree {
  const pos = positionFromFen(fen);
  const normalized = makeFen(pos.toSetup());
  const headers = new Map<string, string>();
  if (normalized !== INITIAL_FEN) {
    headers.set("SetUp", "1");
    headers.set("FEN", normalized);
  }
  return {
    headers,
    nextId: 1,
    root: { id: "root", ply: plyFromFen(pos), fen: normalized, comments: [], nags: [], children: [] },
  };
}

function plyFromFen(pos: Chess): number {
  return (pos.fullmoves - 1) * 2 + (pos.turn === "white" ? 0 : 1);
}

/** Nodes from the root to the end of the path (root first). Stops early at an unknown id. */
export function nodesAlongPath(tree: GameTree, path: TreePath): MoveNode[] {
  const nodes = [tree.root];
  let node = tree.root;
  for (const id of path) {
    const next = node.children.find((c) => c.id === id);
    if (!next) break;
    nodes.push(next);
    node = next;
  }
  return nodes;
}

export function nodeAtPath(tree: GameTree, path: TreePath): MoveNode | undefined {
  const nodes = nodesAlongPath(tree, path);
  return nodes.length === path.length + 1 ? nodes[nodes.length - 1] : undefined;
}

/** Extends `path` by following first children to the end of the line. */
export function mainlineFrom(tree: GameTree, path: TreePath = []): string[] {
  const result = [...path];
  let node = nodeAtPath(tree, path);
  while (node?.children[0]) {
    node = node.children[0];
    result.push(node.id);
  }
  return result;
}

/**
 * Plays a move (chessops Move or UCI string) after the node at `path`.
 * Reuses an existing child for the same move. Returns the new path, or undefined if illegal.
 */
export function addMove(tree: GameTree, path: TreePath, move: Move | string): string[] | undefined {
  const parent = nodeAtPath(tree, path);
  if (!parent) return undefined;
  const raw = typeof move === "string" ? parseUci(move) : move;
  if (!raw) return undefined;
  const pos = positionFromFen(parent.fen);
  // Accepts both king-to-destination (e1g1) and king-takes-rook (e1h1) castling.
  const parsed = normalizeMove(pos, raw);
  if (!pos.isLegal(parsed)) return undefined;
  const uci = makeUci(parsed);
  const existing = parent.children.find((c) => c.uci === uci);
  if (existing) return [...path, existing.id];
  const san = makeSanAndPlay(pos, parsed);
  const child = newNode(tree, { ply: parent.ply + 1, fen: makeFen(pos.toSetup()), san, uci });
  parent.children.push(child);
  return [...path, child.id];
}

/** Makes the node at `path` the first (main) continuation among its siblings. */
export function promoteVariation(tree: GameTree, path: TreePath): void {
  if (path.length === 0) return;
  const parent = nodeAtPath(tree, path.slice(0, -1));
  if (!parent) return;
  const index = parent.children.findIndex((c) => c.id === path[path.length - 1]);
  if (index <= 0) return;
  const [node] = parent.children.splice(index, 1);
  if (node) parent.children.unshift(node);
}

/** Promotes a variation node all the way to `children[0]` at every ancestor branch point. */
export function promoteToMainline(tree: GameTree, path: TreePath): void {
  if (path.length === 0 || !nodeAtPath(tree, path)) return;
  for (let i = 0; i < path.length; i++) {
    const parent = nodeAtPath(tree, path.slice(0, i));
    if (!parent) return;
    const id = path[i];
    const index = parent.children.findIndex((c) => c.id === id);
    if (index > 0) {
      const [node] = parent.children.splice(index, 1);
      if (node) parent.children.unshift(node);
    }
  }
}

const PGN_COMMAND_RE = /\[%[a-zA-Z][a-zA-Z0-9_]*(?:\s+[^\]]*)?\]/g;
const MOVE_EVAL_NAGS = new Set([1, 2, 3, 4, 5, 6, 7]);

/** Extracts human-readable prose from PGN comments, stripping `[%clk ...]`, `[%eval ...]`, etc. */
export function nodeCommentText(comments: readonly string[]): string {
  return comments
    .map((c) => c.replace(PGN_COMMAND_RE, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Sets, replaces, or clears the user prose comment on the node at `path`,
 * while preserving any existing `[%clk ...]` / `[%eval ...]` annotations cleanly.
 */
export function setNodeComment(tree: GameTree, path: TreePath, comment: string): void {
  const node = nodeAtPath(tree, path);
  if (!node) return;
  const tags = node.comments.flatMap((c) => c.match(PGN_COMMAND_RE) ?? []);
  const trimmed = comment.replace(/[{}]/g, "").trim();
  node.comments = trimmed ? [...tags, trimmed] : tags;
}

/**
 * Toggles a NAG on the move at `path`. Move-evaluation NAGs (`$1`–`$7`) are mutually
 * exclusive and preserve any positional NAGs (e.g. `$10`, `$14`, `$16`).
 */
export function toggleNodeNag(tree: GameTree, path: TreePath, nag: number): void {
  if (path.length === 0) return;
  const node = nodeAtPath(tree, path);
  if (!node) return;
  const had = node.nags.includes(nag);
  if (MOVE_EVAL_NAGS.has(nag)) {
    const positional = node.nags.filter((n) => !MOVE_EVAL_NAGS.has(n));
    node.nags = had ? positional : [nag, ...positional];
    return;
  }
  node.nags = had ? node.nags.filter((n) => n !== nag) : [...node.nags, nag];
}

/**
 * Computes the opponent-to-move "threat" FEN by safely swapping the side to move and clearing
 * any en passant square. Returns `null` if the position is invalid or the side to move is in check.
 */
export function threatFen(fen: string): string | null {
  try {
    const pos = positionFromFen(fen);
    const setup = pos.toSetup();
    setup.turn = setup.turn === "white" ? "black" : "white";
    setup.epSquare = undefined;
    const flipped = Chess.fromSetup(setup);
    if (flipped.isErr) return null;
    return makeFen(flipped.value.toSetup());
  } catch {
    return null;
  }
}

/** Removes the node at `path` and everything after it. Returns the parent path. */
export function deleteFrom(tree: GameTree, path: TreePath): string[] {
  const parentPath = path.slice(0, -1);
  const parent = nodeAtPath(tree, parentPath);
  if (parent && path.length > 0) {
    parent.children = parent.children.filter((c) => c.id !== path[path.length - 1]);
  }
  return parentPath;
}

/** Converts a UCI move sequence (e.g. an engine PV) to SAN, stopping at the first illegal move. */
export function uciLineToSan(
  fen: string,
  ucis: readonly string[],
  maxMoves = Number.POSITIVE_INFINITY,
): string[] {
  const pos = positionFromFen(fen);
  const sans: string[] = [];
  for (const uci of ucis.slice(0, maxMoves)) {
    const raw = parseUci(uci);
    if (!raw) break;
    const move = normalizeMove(pos, raw);
    if (!pos.isLegal(move)) break;
    sans.push(makeSanAndPlay(pos, move));
  }
  return sans;
}

/** Remaining clock in seconds from a PGN comment's `[%clk h:mm:ss]` command, or null. */
export function clockFromComments(comments: readonly string[]): number | null {
  for (const c of comments) {
    const m = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(c);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return null;
}

/** Parses the first game of a PGN. Illegal moves cut their line short. Throws on invalid start position. */
export function treeFromPgn(pgn: string): GameTree {
  const game = parsePgn(pgn)[0];
  if (!game) throw new InvalidPositionError("No game found in PGN", "ERR_NO_GAME");
  const start = startingPosition(game.headers);
  if (start.isErr)
    throw new InvalidPositionError(`Invalid PGN start position: ${start.error.message}`, "ERR_PGN_START");
  const tree = createTree(makeFen(start.value.toSetup()));
  for (const [key, value] of game.headers) tree.headers.set(key, value);
  tree.root.comments = game.comments ?? [];

  const attach = (src: Node<PgnNodeData>, dst: MoveNode) => {
    for (const child of src.children) {
      const pos = positionFromFen(dst.fen);
      const move = parseSan(pos, child.data.san);
      if (!move) continue;
      const san = makeSanAndPlay(pos, move);
      const node = newNode(tree, { ply: dst.ply + 1, fen: makeFen(pos.toSetup()), san, uci: makeUci(move) });
      node.comments = [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])];
      node.nags = child.data.nags ?? [];
      dst.children.push(node);
      attach(child, node);
    }
  };
  attach(game.moves, tree.root);
  return tree;
}

export function treeToPgn(tree: GameTree): string {
  const game: Game<PgnNodeData> = defaultGame(() => new Map(tree.headers));
  if (tree.root.comments.length) game.comments = tree.root.comments;
  const attach = (src: MoveNode, dst: Node<PgnNodeData>) => {
    for (const child of src.children) {
      if (!child.san) continue;
      const data: PgnNodeData = { san: child.san };
      if (child.comments.length) data.comments = child.comments;
      if (child.nags.length) data.nags = child.nags;
      const node = new ChildNode(data);
      dst.children.push(node);
      attach(child, node);
    }
  };
  attach(tree.root, game.moves);
  return makePgn(game);
}
