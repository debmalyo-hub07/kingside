// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Color, Score } from "@kingside/chess-core";

export interface EngineInfo {
  depth: number;
  multipv: number;
  /** White-POV score. */
  score: Score;
  /** Principal variation in UCI notation (e.g. "e2e4"). */
  pv: string[];
  nodes?: number;
  nps?: number;
}

/**
 * Parses a UCI `info` line into White-POV engine info.
 * Returns null for lines without depth, score and pv (e.g. `info string`, `currmove`).
 */
export function parseInfoLine(line: string, sideToMove: Color): EngineInfo | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "info") return null;

  let depth: number | undefined;
  let multipv = 1;
  let score: Score | undefined;
  let nodes: number | undefined;
  let nps: number | undefined;
  let pv: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token) {
      case "depth":
        depth = Number(tokens[++i]);
        break;
      case "multipv":
        multipv = Number(tokens[++i]);
        break;
      case "nodes":
        nodes = Number(tokens[++i]);
        break;
      case "nps":
        nps = Number(tokens[++i]);
        break;
      case "score": {
        const kind = tokens[++i];
        const value = Number(tokens[++i]);
        // Bound scores (lowerbound/upperbound) are intermediate; skip them.
        if (tokens[i + 1] === "lowerbound" || tokens[i + 1] === "upperbound") return null;
        const sign = sideToMove === "white" ? 1 : -1;
        if (kind === "cp") score = { cp: value * sign };
        else if (kind === "mate") score = { mate: value * sign };
        break;
      }
      case "pv":
        pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
    }
  }

  if (depth === undefined || score === undefined || pv.length === 0) return null;
  const info: EngineInfo = { depth, multipv, score, pv };
  if (nodes !== undefined) info.nodes = nodes;
  if (nps !== undefined) info.nps = nps;
  return info;
}

/** Parses `bestmove e2e4 ponder e7e5`. Returns null for `bestmove (none)`. */
export function parseBestMove(line: string): { best: string; ponder?: string } | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "bestmove" || !tokens[1] || tokens[1] === "(none)") return null;
  return tokens[2] === "ponder" && tokens[3] ? { best: tokens[1], ponder: tokens[3] } : { best: tokens[1] };
}
