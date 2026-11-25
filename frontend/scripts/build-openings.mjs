// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds public/data/openings.json from lichess-org/chess-openings (CC0) at a pinned commit.
// Output: { named: { [epd]: [eco, name] }, book: string[] } where `book` holds every position
// reached along any named line (used for "Book" move detection).
// Run: node frontend/scripts/build-openings.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parsePgn } from "chessops/pgn";
import { parseSan } from "chessops/san";

const COMMIT = "a6189a30dc273ccb21fc2536a9a2fefd5592a67a";
const FILES = ["a", "b", "c", "d", "e"];

/** EPD = first four FEN fields (board, turn, castling, en passant). */
const epd = (pos) => makeFen(pos.toSetup()).split(" ").slice(0, 4).join(" ");

const named = {};
const book = new Set();
let lines = 0;

for (const f of FILES) {
  const url = `https://raw.githubusercontent.com/lichess-org/chess-openings/${COMMIT}/${f}.tsv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const rows = (await res.text()).trim().split("\n").slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split("\t");
    const game = parsePgn(pgn)[0];
    const pos = Chess.default();
    let ok = true;
    for (const node of game.moves.mainlineNodes()) {
      const move = parseSan(pos, node.data.san);
      if (!move) {
        ok = false;
        break;
      }
      pos.play(move);
      book.add(epd(pos));
    }
    if (!ok) throw new Error(`Illegal line: ${eco} ${name}`);
    // Later (longer) lines with the same position keep the first, most general name.
    named[epd(pos)] ??= [eco, name];
    lines++;
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "openings.json");
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify({ source: `lichess-org/chess-openings@${COMMIT} (CC0)`, named, book: [...book] }),
);
console.log(
  `${lines} lines, ${Object.keys(named).length} named positions, ${book.size} book positions -> ${out}`,
);
