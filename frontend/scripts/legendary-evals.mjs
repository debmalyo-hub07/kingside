// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-computes Stockfish evaluations for the home page's legendary games (besides the hero's Immortal Game,
// see hero-evals.mjs) so the home page never downloads the engine. Game scores are historical records.
// Run: node frontend/scripts/legendary-evals.mjs  → frontend/features/home/legendary-games-data.ts

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";

const require = createRequire(import.meta.url);
const DEPTH = 15;

const GAMES = [
  {
    id: "evergreen",
    white: "Adolf Anderssen",
    black: "Jean Dufresne",
    event: "Berlin, 1852",
    result: "1-0",
    moves:
      "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4 Bxb4 5.c3 Ba5 6.d4 exd4 7.O-O d3 8.Qb3 Qf6 9.e5 Qg6 10.Re1 Nge7 11.Ba3 b5 12.Qxb5 Rb8 13.Qa4 Bb6 14.Nbd2 Bb7 15.Ne4 Qf5 16.Bxd3 Qh5 17.Nf6+ gxf6 18.exf6 Rg8 19.Rad1 Qxf3 20.Rxe7+ Nxe7 21.Qxd7+ Kxd7 22.Bf5+ Ke8 23.Bd7+ Kf8 24.Bxe7#",
  },
  {
    id: "opera",
    white: "Paul Morphy",
    black: "Duke Karl / Count Isouard",
    event: "Paris, 1858",
    result: "1-0",
    moves:
      "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8#",
  },
  {
    id: "lasker-bauer",
    white: "Emanuel Lasker",
    black: "Johann Bauer",
    event: "Amsterdam, 1889",
    result: "1-0",
    moves:
      "1.f4 d5 2.e3 Nf6 3.b3 e6 4.Bb2 Be7 5.Bd3 b6 6.Nc3 Bb7 7.Nf3 Nbd7 8.O-O O-O 9.Ne2 c5 10.Ng3 Qc7 11.Ne5 Nxe5 12.Bxe5 Qc6 13.Qe2 a6 14.Nh5 Nxh5 15.Bxh7+ Kxh7 16.Qxh5+ Kg8 17.Bxg7 Kxg7 18.Qg4+ Kh7 19.Rf3 e5 20.Rh3+ Qh6 21.Rxh6+ Kxh6 22.Qd7 Bf6 23.Qxb7 Kg7 24.Rf1 Rab8 25.Qd7 Rfd8 26.Qg4+ Kf8 27.fxe5 Bg7 28.e6 Rb7 29.Qg6 f6 30.Rxf6+ Bxf6 31.Qxf6+ Ke8 32.Qh8+ Ke7 33.Qg7+ Kxe6 34.Qxb7 Rd6 35.Qxa6 d4 36.exd4 cxd4 37.h4 d3 38.Qxd3",
  },
  {
    id: "century",
    white: "Donald Byrne",
    black: "Robert James Fischer",
    event: "New York, 1956",
    result: "0-1",
    moves:
      "1.Nf3 Nf6 2.c4 g6 3.Nc3 Bg7 4.d4 O-O 5.Bf4 d5 6.Qb3 dxc4 7.Qxc4 c6 8.e4 Nbd7 9.Rd1 Nb6 10.Qc5 Bg4 11.Bg5 Na4 12.Qa3 Nxc3 13.bxc3 Nxe4 14.Bxe7 Qb6 15.Bc4 Nxc3 16.Bc5 Rfe8+ 17.Kf1 Be6 18.Bxb6 Bxc4+ 19.Kg1 Ne2+ 20.Kf1 Nxd4+ 21.Kg1 Ne2+ 22.Kf1 Nc3+ 23.Kg1 axb6 24.Qb4 Ra4 25.Qxb6 Nxd1 26.h3 Rxa2 27.Kh2 Nxf2 28.Re1 Rxe1 29.Qd8+ Bf8 30.Nxe1 Bd5 31.Nf3 Ne4 32.Qb8 b5 33.h4 h5 34.Ne5 Kg7 35.Kg1 Bc5+ 36.Kf1 Ng3+ 37.Ke1 Bb4+ 38.Kd1 Bb3+ 39.Kc1 Ne2+ 40.Kb1 Nc3+ 41.Kc1 Rc2#",
  },
  {
    id: "kasparov-topalov",
    white: "Garry Kasparov",
    black: "Veselin Topalov",
    event: "Wijk aan Zee, 1999",
    result: "1-0",
    moves:
      "1.e4 d6 2.d4 Nf6 3.Nc3 g6 4.Be3 Bg7 5.Qd2 c6 6.f3 b5 7.Nge2 Nbd7 8.Bh6 Bxh6 9.Qxh6 Bb7 10.a3 e5 11.O-O-O Qe7 12.Kb1 a6 13.Nc1 O-O-O 14.Nb3 exd4 15.Rxd4 c5 16.Rd1 Nb6 17.g3 Kb8 18.Na5 Ba8 19.Bh3 d5 20.Qf4+ Ka7 21.Rhe1 d4 22.Nd5 Nbxd5 23.exd5 Qd6 24.Rxd4 cxd4 25.Re7+ Kb6 26.Qxd4+ Kxa5 27.b4+ Ka4 28.Qc3 Qxd5 29.Ra7 Bb7 30.Rxb7 Qc4 31.Qxf6 Kxa3 32.Qxa6+ Kxb4 33.c3+ Kxc3 34.Qa1+ Kd2 35.Qb2+ Kd1 36.Bf1 Rd2 37.Rd7 Rxd7 38.Bxc4 bxc4 39.Qxh8 Rd3 40.Qa8 c3 41.Qa4+ Ke1 42.f4 f5 43.Kc1 Rd2 44.Qa7",
  },
];

const engine = require("stockfish")("single", onLine);
let resolveSearch = () => {};
let last = null;
function onLine(line) {
  const m = line.match(/^info .*\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)/);
  if (m) last = { kind: m[2], value: Number(m[3]) };
  if (line.startsWith("bestmove")) resolveSearch();
}
const search = (fen) =>
  new Promise((resolve) => {
    last = null;
    resolveSearch = () => resolve(last);
    engine.processCommand(`position fen ${fen}`);
    engine.processCommand(`go depth ${DEPTH}`);
  });
engine.processCommand("uci");
engine.processCommand("setoption name Hash value 64");

const out = [];
for (const g of GAMES) {
  const game = parsePgn(`[Result "${g.result}"]\n\n${g.moves} ${g.result}`)[0];
  const pos = startingPosition(game.headers).unwrap();
  const plies = [{ fen: makeFen(pos.toSetup()) }];
  for (const node of game.moves.mainlineNodes()) {
    const move = parseSan(pos, node.data.san);
    if (!move) throw new Error(`${g.id}: illegal move ${node.data.san}`);
    const uci = makeUci(move);
    const san = makeSanAndPlay(pos, move);
    plies.push({ fen: makeFen(pos.toSetup()), san, uci });
  }
  engine.processCommand("ucinewgame");
  const scored = [];
  for (const ply of plies) {
    const p = Chess.fromSetup(parseFen(ply.fen).unwrap()).unwrap();
    let score;
    if (p.isCheckmate()) score = { mate: 0 };
    else {
      const r = await search(ply.fen);
      const sign = p.turn === "white" ? 1 : -1;
      score = r.kind === "mate" ? { mate: r.value * sign } : { cp: r.value * sign };
    }
    scored.push({ ...ply, score });
  }
  const { moves, ...meta } = g;
  out.push({
    ...meta,
    pgn: `[White "${g.white}"]\n[Black "${g.black}"]\n[Event "${g.event}"]\n[Result "${g.result}"]\n\n${moves} ${g.result}`,
    plies: scored,
  });
  console.log(`${g.id}: ${plies.length - 1} plies`);
}
engine.terminate();

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "features",
  "home",
  "legendary-games-data.ts",
);
await writeFile(
  file,
  `// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated by frontend/scripts/legendary-evals.mjs (Stockfish 19, depth ${DEPTH}). Do not edit by hand.
// Historical game scores (public records); titles and notes are Kingside's own (messages/en.json).

import type { LegendaryGame } from "./hero-game-data";

export const LEGENDARY_GAMES: LegendaryGame[] = ${JSON.stringify(out)};
`,
);
console.log(`wrote ${file}`);
process.exit(0);
