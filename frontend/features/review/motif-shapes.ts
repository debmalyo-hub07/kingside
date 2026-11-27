// SPDX-License-Identifier: AGPL-3.0-or-later
// Translates pure explainMove() tactical reasons into semantic Chessground square highlights.

import type { Reason } from "@kingside/chess-core";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { parseSquare } from "chessops/util";

export type MotifBrush = "yellow" | "red" | "blue";

/** Semantic brush assignment per tactical reason code (never relies on color alone when paired with text). */
const BRUSH_BY_CODE: Partial<Record<Reason["code"], MotifBrush>> = {
  // Vulnerability / hanging / allows-tactic squares
  hangs: "red",
  allowsFork: "red",
  allowsPin: "red",
  allowsSkewer: "red",
  allowsDiscoveredAttack: "red",
  trappedPiece: "red",
  allowsBackRank: "red",
  // Defending / deflected squares
  deflection: "blue",
  allowsDeflection: "blue",
  // Tactical targets / sacrifices executed by the mover
  pins: "yellow",
  skewers: "yellow",
  discoveredAttack: "yellow",
  trapsPiece: "yellow",
  backRank: "yellow",
  sacrifice: "yellow",
};

/**
 * Converts `explainMove()` Reason objects into deduplicated Chessground `DrawShape` square circles.
 * Pure & deterministic so it can be unit-tested without DOM or Chessground.
 */
export function motifShapesForReasons(reasons: readonly Reason[]): DrawShape[] {
  const seen = new Set<string>();
  const shapes: DrawShape[] = [];
  for (const r of reasons) {
    const brush = BRUSH_BY_CODE[r.code];
    if (!brush || !("square" in r)) continue;
    if (parseSquare(r.square) === undefined || seen.has(r.square)) continue;
    seen.add(r.square);
    shapes.push({ orig: r.square as Key, brush });
  }
  return shapes;
}
