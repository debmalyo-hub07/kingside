// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared MongoDB EvalCache API for Kingside's own Stockfish 19 evaluations ONLY.
// Lichess cloud-eval must never enter this route or collection (THIRD_PARTY_NOTICES.md).

import { InvalidPositionError, isLegalPv, normalizeFen } from "@kingside/chess-core";
import {
  connectDb,
  type EvalCacheWrite,
  epdFromFen,
  getEvalCache,
  getEvalCacheBatch,
  isKingsideEngineTag,
  putEvalCacheBatch,
} from "@kingside/db";
import { Hono } from "hono";
import { z } from "zod";
import { readBoundedText } from "../lib/http";
import { rateLimit } from "../middleware/rate-limit";

const MAX_BODY_BYTES = 512 * 1024;
const UCI_MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const lineSchema = z
  .object({
    pv: z.array(z.string().regex(UCI_MOVE_RE)).min(1).max(24),
    cp: z.number().int().min(-100_000).max(100_000).optional(),
    mate: z
      .number()
      .int()
      .min(-500)
      .max(500)
      .refine((n) => n !== 0)
      .optional(),
    depth: z.number().int().min(1).max(127),
  })
  .refine((l) => (l.cp !== undefined) !== (l.mate !== undefined), {
    message: "line must have either cp or mate",
  });

const entrySchema = z.object({
  fen: z.string().min(10).max(100),
  engine: z.string().min(1).max(64),
  depth: z.number().int().min(1).max(20_000),
  multipv: z.number().int().min(1).max(5),
  lines: z.array(lineSchema).min(1).max(5),
});

const writeBodySchema = z.object({
  entries: z.array(entrySchema).min(1).max(80),
});

const lookupQuerySchema = z.object({
  fen: z.string().min(10).max(100),
  engine: z.string().min(1).max(64),
  depth: z.coerce.number().int().min(1).max(20_000).default(1),
  multiPv: z.coerce.number().int().min(1).max(5).default(1),
});

const batchLookupBodySchema = z.object({
  items: z
    .array(
      z.object({
        fen: z.string().min(10).max(100),
        engine: z.string().min(1).max(64),
        depth: z.number().int().min(1).max(20_000).optional(),
        multiPv: z.number().int().min(1).max(5).optional(),
      }),
    )
    .min(1)
    .max(120),
});

const getLimit = rateLimit({ limit: 120, windowMs: 60_000, prefix: "eval-cache-get" });
const postLimit = rateLimit({ limit: 60, windowMs: 60_000, prefix: "eval-cache-post" });

async function ensureDbAvailable(): Promise<boolean> {
  if (!process.env.MONGODB_URI?.trim()) return false;
  try {
    await connectDb();
    return true;
  } catch {
    return false;
  }
}

export const evalCacheRoutes = new Hono()
  .get("/", getLimit, async (c) => {
    const q = lookupQuerySchema.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "invalid_request" }, 400);
    if (!isKingsideEngineTag(q.data.engine)) return c.json({ error: "invalid_engine" }, 400);

    let normalized: string;
    try {
      normalized = normalizeFen(q.data.fen);
    } catch (e) {
      if (e instanceof InvalidPositionError) return c.json({ error: "invalid_fen" }, 400);
      throw e;
    }

    if (!(await ensureDbAvailable())) return c.json({ error: "db_unavailable" }, 503);
    const hit = await getEvalCache(epdFromFen(normalized), q.data.engine, q.data.depth, q.data.multiPv);
    if (!hit) return c.json({ error: "not_found" }, 404);
    c.header("Cache-Control", "public, max-age=300");
    return c.json(hit);
  })
  .post("/lookup", getLimit, async (c) => {
    const raw = await readBoundedText(c.req.raw, MAX_BODY_BYTES);
    if (raw === "too_large") return c.json({ error: "too_large" }, 413);
    if (!raw) return c.json({ error: "invalid_request" }, 400);

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const parsed = batchLookupBodySchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    const queries = [];
    for (const item of parsed.data.items) {
      if (!isKingsideEngineTag(item.engine)) return c.json({ error: "invalid_engine" }, 400);
      let normalized: string;
      try {
        normalized = normalizeFen(item.fen);
      } catch (e) {
        if (e instanceof InvalidPositionError) return c.json({ error: "invalid_fen" }, 400);
        throw e;
      }
      queries.push({
        epd: epdFromFen(normalized),
        engine: item.engine,
        ...(item.depth !== undefined ? { minDepth: item.depth } : {}),
        ...(item.multiPv !== undefined ? { minMultipv: item.multiPv } : {}),
      });
    }

    if (!(await ensureDbAvailable())) return c.json({ error: "db_unavailable" }, 503);
    const items = await getEvalCacheBatch(queries);
    return c.json({ items });
  })
  .post("/", postLimit, async (c) => {
    const raw = await readBoundedText(c.req.raw, MAX_BODY_BYTES);
    if (raw === "too_large") return c.json({ error: "too_large" }, 413);
    if (!raw) return c.json({ error: "invalid_request" }, 400);

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const parsed = writeBodySchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    const validated: EvalCacheWrite[] = [];
    for (const entry of parsed.data.entries) {
      if (!isKingsideEngineTag(entry.engine)) return c.json({ error: "invalid_engine" }, 400);
      const isNodeBudget = entry.engine.endsWith("|nodes");
      if (!isNodeBudget && entry.depth > 127) {
        return c.json({ error: "invalid_request" }, 400);
      }
      if (entry.lines.length > entry.multipv) {
        return c.json({ error: "invalid_request" }, 400);
      }

      let normalized: string;
      try {
        normalized = normalizeFen(entry.fen);
      } catch (e) {
        if (e instanceof InvalidPositionError) return c.json({ error: "invalid_fen" }, 400);
        throw e;
      }

      if (!entry.lines.every((l) => isLegalPv(normalized, l.pv))) {
        return c.json({ error: "invalid_pv" }, 400);
      }

      validated.push({
        epd: epdFromFen(normalized),
        engine: entry.engine,
        depth: entry.depth,
        multipv: entry.multipv,
        lines: entry.lines.map((l) => ({
          pv: l.pv,
          depth: l.depth,
          ...(l.cp !== undefined ? { cp: l.cp } : {}),
          ...(l.mate !== undefined ? { mate: l.mate } : {}),
        })),
      });
    }

    if (!(await ensureDbAvailable())) return c.json({ error: "db_unavailable" }, 503);
    const stored = await putEvalCacheBatch(validated);
    return c.json({ stored }, 200);
  });
