// SPDX-License-Identifier: AGPL-3.0-or-later

import { InvalidPositionError, isTablebasePosition, normalizeFen } from "@kingside/chess-core";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit } from "../middleware/rate-limit";
import { fetchTablebase, LichessDataError, type TablebaseResult } from "../services/lichess-data";
import { TtlCache } from "../services/ttl-cache";

const query = z.object({ fen: z.string().min(10).max(100) });

// Tablebase answers never change.
const cache = new TtlCache<TablebaseResult>(24 * 60 * 60_000, 5_000);

/** GET /api/tablebase?fen= — 7-piece Syzygy lookup (data from lichess.org). */
export const tablebaseRoutes = new Hono()
  .use("*", rateLimit({ limit: 60, windowMs: 60_000, prefix: "tablebase" }))
  .get("/", async (c) => {
    const q = query.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "invalid_request" }, 400);
    let fen: string;
    try {
      fen = normalizeFen(q.data.fen);
    } catch (e) {
      if (e instanceof InvalidPositionError) return c.json({ error: "invalid_fen" }, 400);
      throw e;
    }
    if (!isTablebasePosition(fen)) return c.json({ error: "not_in_tablebase" }, 400);
    const key = fen.split(" ").slice(0, 4).join(" ");
    const hit = cache.get(key);
    if (hit) return c.json(hit);
    try {
      const result = await fetchTablebase(fen);
      cache.set(key, result);
      c.header("Cache-Control", "public, max-age=86400");
      return c.json(result);
    } catch (e) {
      if (e instanceof LichessDataError) return c.json({ error: e.code }, e.status);
      throw e;
    }
  });
