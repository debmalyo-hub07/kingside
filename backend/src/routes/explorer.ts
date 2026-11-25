// SPDX-License-Identifier: AGPL-3.0-or-later

import { InvalidPositionError, normalizeFen } from "@kingside/chess-core";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit } from "../middleware/rate-limit";
import {
  type ExplorerResult,
  explorerConfigured,
  fetchExplorer,
  LichessDataError,
} from "../services/lichess-data";
import { TtlCache } from "../services/ttl-cache";

const params = z.object({ db: z.enum(["masters", "lichess"]) });
const query = z.object({ fen: z.string().min(10).max(100) });

// Masters data barely changes; online stats drift slowly. Popular positions repeat a lot.
const cache = new TtlCache<ExplorerResult>(6 * 60 * 60_000, 5_000);

/**
 * GET /api/explorer/status     { available } — lets the frontend skip calls that would fail
 * GET /api/explorer/:db?fen=   db = masters | lichess
 * Opening statistics from the Lichess opening explorer (data from lichess.org).
 * 503 { error: "explorer_unavailable" } when no LICHESS_TOKEN is configured — the frontend then
 * falls back to its own CC0 opening book.
 */
export const explorerRoutes = new Hono()
  .use("*", rateLimit({ limit: 60, windowMs: 60_000, prefix: "explorer" }))
  .get("/status", (c) => c.json({ available: explorerConfigured() }))
  .get("/:db", async (c) => {
    const p = params.safeParse(c.req.param());
    const q = query.safeParse(c.req.query());
    if (!p.success || !q.success) return c.json({ error: "invalid_request" }, 400);
    let fen: string;
    try {
      fen = normalizeFen(q.data.fen);
    } catch (e) {
      if (e instanceof InvalidPositionError) return c.json({ error: "invalid_fen" }, 400);
      throw e;
    }
    // Move counters do not change explorer results.
    const key = `${p.data.db}|${fen.split(" ").slice(0, 4).join(" ")}`;
    const hit = cache.get(key);
    if (hit) return c.json(hit);
    try {
      const result = await fetchExplorer(p.data.db, fen);
      cache.set(key, result);
      c.header("Cache-Control", "public, max-age=3600");
      return c.json(result);
    } catch (e) {
      if (e instanceof LichessDataError) return c.json({ error: e.code }, e.status);
      throw e;
    }
  });
