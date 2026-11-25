// SPDX-License-Identifier: AGPL-3.0-or-later
// Imports a balanced, high-quality subset of the Lichess puzzle database (CC0) into MongoDB.
// Source: https://database.lichess.org/#puzzles (lichess_db_puzzle.csv.zst)
// Run: pnpm import:puzzles   (downloads ~300 MB once into scripts/data/, re-runs are idempotent)

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { connectDb, disconnectDb } from "../connect";
import { Puzzle } from "../models";

const URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const FILE = join(ROOT, "scripts", "data", "lichess_db_puzzle.csv.zst");

/** Quality filters and balance: see docs/ROADMAP.md Phase 3 (Atlas M0 has 512 MB). */
const MIN_POPULARITY = 85;
const MIN_PLAYS = 300;
const MAX_RATING_DEV = 90;
const BUCKET = 100;
const PER_BUCKET = 10_000;
const BATCH = 1_000;

async function download(): Promise<void> {
  if (existsSync(FILE)) return;
  await mkdir(dirname(FILE), { recursive: true });
  console.log(`downloading ${URL} …`);
  const res = await fetch(URL, { headers: { "User-Agent": "Kingside/0.1 (open-source puzzle import)" } });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${FILE}.part`));
  const { rename } = await import("node:fs/promises");
  await rename(`${FILE}.part`, FILE);
}

const SKIPPABLE_MAGIC_MIN = 0x184d2a50;
const SKIPPABLE_MAGIC_MAX = 0x184d2a5f;

/**
 * The dump is written by pzstd: every zstd frame is preceded by a 12-byte skippable frame whose payload is
 * the compressed size of the next frame. Node's zstd stream rejects skippable frames, so walk the file and
 * decompress frame by frame. Other skippable frames (e.g. a trailing seek table) are skipped.
 */
async function* decompressFrames(path: string): AsyncGenerator<Buffer> {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(8);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await file.read(header, 0, 8, offset);
      if (bytesRead < 8) return;
      const magic = header.readUInt32LE(0);
      const size = header.readUInt32LE(4);
      if (magic < SKIPPABLE_MAGIC_MIN || magic > SKIPPABLE_MAGIC_MAX) {
        throw new Error(`unexpected data at byte ${offset} (not a pzstd stream)`);
      }
      offset += 8;
      if (size !== 4) {
        offset += size; // not a frame-size marker
        continue;
      }
      const sizeBuf = Buffer.alloc(4);
      await file.read(sizeBuf, 0, 4, offset);
      offset += 4;
      const frameSize = sizeBuf.readUInt32LE(0);
      const frame = Buffer.alloc(frameSize);
      await file.read(frame, 0, frameSize, offset);
      offset += frameSize;
      yield zstdDecompressSync(frame);
    }
  } finally {
    await file.close();
  }
}

interface PuzzleDoc {
  _id: string;
  fen: string;
  moves: string[];
  rating: number;
  ratingDev: number;
  popularity: number;
  nbPlays: number;
  themes: string[];
  openingTags: string[];
  gameUrl: string;
  rnd: number;
}

async function main() {
  await download();
  await connectDb();
  const counts = new Map<number, number>();
  let read = 0;
  let kept = 0;
  let batch: PuzzleDoc[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await Puzzle.bulkWrite(
      batch.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
      { ordered: false },
    );
    batch = [];
  };

  const lines = createInterface({ input: Readable.from(decompressFrames(FILE)), crlfDelay: Infinity });
  for await (const line of lines) {
    if (read++ === 0 && line.startsWith("PuzzleId")) continue;
    const [id, fen, moves, rating, dev, popularity, plays, themes, gameUrl, openingTags] = line.split(",");
    if (!id || !fen || !moves) continue;
    const r = Number(rating);
    if (Number(popularity) < MIN_POPULARITY || Number(plays) < MIN_PLAYS || Number(dev) > MAX_RATING_DEV)
      continue;
    const bucket = Math.floor(r / BUCKET);
    const n = counts.get(bucket) ?? 0;
    if (n >= PER_BUCKET) continue;
    counts.set(bucket, n + 1);
    batch.push({
      _id: id,
      fen,
      moves: moves.split(" "),
      rating: r,
      ratingDev: Number(dev),
      popularity: Number(popularity),
      nbPlays: Number(plays),
      themes: themes ? themes.split(" ") : [],
      openingTags: openingTags ? openingTags.split(" ") : [],
      gameUrl: gameUrl ?? "",
      rnd: Math.random(),
    });
    kept++;
    if (batch.length >= BATCH) {
      await flush();
      process.stdout.write(`\rread ${read.toLocaleString()} · kept ${kept.toLocaleString()}`);
    }
  }
  await flush();
  console.log(`\nread ${read.toLocaleString()} rows, imported ${kept.toLocaleString()} puzzles`);
  const buckets = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  console.log(buckets.map(([b, n]) => `${b * BUCKET}:${n}`).join(" "));
}

try {
  await main();
} finally {
  await disconnectDb();
}
