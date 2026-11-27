// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared MongoDB evaluation cache for Kingside's own Stockfish 19 evaluations ONLY.
// Strictly rejects third-party Lichess cloud-eval tags per THIRD_PARTY_NOTICES.md.

import mongoose from "mongoose";
import { EvalCache } from "./models";

/** Only Kingside's own Stockfish 19 engine identifiers may be persisted in MongoDB EvalCache. */
const KINGSIDE_ENGINE_RE = /^Stockfish 19 (?:NNUE|Lite)(?:\|nodes)?$/;

export interface EvalCacheLine {
  pv: string[];
  cp?: number;
  mate?: number;
  depth: number;
}

export interface EvalCacheEntry {
  key: string;
  epd: string;
  engine: string;
  depth: number;
  multipv: number;
  lines: EvalCacheLine[];
  createdAt?: string;
}

export interface EvalCacheQuery {
  epd: string;
  engine: string;
  minDepth?: number;
  minMultipv?: number;
}

export interface EvalCacheWrite {
  epd: string;
  engine: string;
  depth: number;
  multipv: number;
  lines: EvalCacheLine[];
}

interface RawEvalDoc {
  _id: string;
  depth: number;
  multipv: number;
  lines: { pv: string[]; cp?: number; mate?: number; depth: number }[];
  engine: string;
  createdAt?: Date;
}

export function isKingsideEngineTag(engine: string): boolean {
  return KINGSIDE_ENGINE_RE.test(engine) && !/lichess|cloud/i.test(engine);
}

/** 4-field canonical EPD prefix from a FEN string. */
export function epdFromFen(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export function evalCacheKey(epdOrFen: string, engine: string): string {
  return `${epdFromFen(epdOrFen)}|${engine}`;
}

function sanitizeLine(l: { pv: string[]; cp?: number; mate?: number; depth: number }): EvalCacheLine {
  return {
    pv: [...l.pv],
    depth: l.depth,
    ...(typeof l.cp === "number" ? { cp: l.cp } : {}),
    ...(typeof l.mate === "number" ? { mate: l.mate } : {}),
  };
}

function toDto(doc: RawEvalDoc, epd: string): EvalCacheEntry {
  return {
    key: doc._id,
    epd,
    engine: doc.engine,
    depth: doc.depth,
    multipv: doc.multipv,
    lines: doc.lines.map(sanitizeLine),
    ...(doc.createdAt ? { createdAt: doc.createdAt.toISOString() } : {}),
  };
}

export async function getEvalCache(
  epdOrFen: string,
  engine: string,
  minDepth = 1,
  minMultipv = 1,
): Promise<EvalCacheEntry | null> {
  if (!isKingsideEngineTag(engine)) return null;
  const epd = epdFromFen(epdOrFen);
  const key = evalCacheKey(epd, engine);
  const doc = await EvalCache.findById(key).lean<RawEvalDoc>();
  if (!doc || !isKingsideEngineTag(doc.engine)) return null;
  if (doc.depth < minDepth || doc.multipv < minMultipv || doc.lines.length === 0) return null;
  return toDto(doc, epd);
}

export async function getEvalCacheBatch(
  queries: readonly EvalCacheQuery[],
): Promise<Record<string, EvalCacheEntry>> {
  const valid = queries
    .filter((q) => isKingsideEngineTag(q.engine))
    .map((q) => {
      const epd = epdFromFen(q.epd);
      return {
        epd,
        engine: q.engine,
        key: evalCacheKey(epd, q.engine),
        minDepth: q.minDepth ?? 1,
        minMultipv: q.minMultipv ?? 1,
      };
    });
  if (valid.length === 0) return {};

  const ids = [...new Set(valid.map((q) => q.key))];
  const docs = await EvalCache.find({ _id: mongoose.trusted({ $in: ids }) }).lean<RawEvalDoc[]>();
  const byId = new Map<string, RawEvalDoc>(docs.map((d) => [d._id, d]));

  const out: Record<string, EvalCacheEntry> = {};
  for (const q of valid) {
    const doc = byId.get(q.key);
    if (!doc || !isKingsideEngineTag(doc.engine)) continue;
    if (doc.depth < q.minDepth || doc.multipv < q.minMultipv || doc.lines.length === 0) continue;
    out[q.key] = toDto(doc, q.epd);
  }
  return out;
}

export async function putEvalCacheBatch(entries: readonly EvalCacheWrite[]): Promise<number> {
  const deduped = new Map<
    string,
    { key: string; epd: string; engine: string; depth: number; multipv: number; lines: EvalCacheLine[] }
  >();

  for (const raw of entries) {
    if (!isKingsideEngineTag(raw.engine)) {
      throw new Error(`Refusing non-Kingside engine tag in EvalCache: ${raw.engine}`);
    }
    if (!Number.isFinite(raw.depth) || raw.depth < 1 || raw.multipv < 1 || raw.lines.length === 0) {
      continue;
    }
    const epd = epdFromFen(raw.epd);
    const key = evalCacheKey(epd, raw.engine);
    const prev = deduped.get(key);
    if (!prev || raw.depth > prev.depth || (raw.depth === prev.depth && raw.multipv > prev.multipv)) {
      deduped.set(key, {
        key,
        epd,
        engine: raw.engine,
        depth: raw.depth,
        multipv: raw.multipv,
        lines: raw.lines.map(sanitizeLine),
      });
    }
  }

  if (deduped.size === 0) return 0;

  const existing = await EvalCache.find(
    { _id: mongoose.trusted({ $in: [...deduped.keys()] }) },
    { _id: 1, depth: 1, multipv: 1 },
  ).lean<{ _id: string; depth: number; multipv: number }[]>();
  const existingById = new Map(existing.map((d) => [d._id, d]));

  const ops = [];
  const now = new Date();
  for (const entry of deduped.values()) {
    const old = existingById.get(entry.key);
    if (old && (old.depth > entry.depth || (old.depth === entry.depth && old.multipv >= entry.multipv))) {
      continue;
    }
    ops.push({
      updateOne: {
        filter: { _id: entry.key },
        update: {
          $set: {
            depth: entry.depth,
            multipv: entry.multipv,
            lines: entry.lines,
            engine: entry.engine,
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length === 0) return 0;
  await EvalCache.bulkWrite(ops, { ordered: false });
  return ops.length;
}
