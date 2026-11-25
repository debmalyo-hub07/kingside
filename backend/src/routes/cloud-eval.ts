// SPDX-License-Identifier: AGPL-3.0-or-later

import { InvalidPositionError, normalizeFen } from "@kingside/chess-core";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit } from "../middleware/rate-limit";
import { type CloudEval, fetchCloudEval, LichessDataError } from "../services/lichess-data";
import { TtlCache } from "../services/ttl-cache";

const query = z.object({
  fen: z.string().min(10).max(100),
  multiPv: z.coerce.number().int().min(1).max(5).default(2),
});

// Stored cloud evaluations rarely change; "not stored" answers are cached too (shorter) so a review of a
// rare line does not ask Lichess again for every position.
const hits = new TtlCache<CloudEval>(24 * 60 * 60_000, 20_000);
const misses = new TtlCache<true>(6 * 60 * 60_000, 20_000);

/**
 * GET /api/cloud-eval?fen=&multiPv=  stored engine evaluation of a position (data from lichess.org).
 * 404 { error: "not_found" } when the position is not stored. Reviews use it for opening positions,
 * where it is deeper than anything a browser can compute in a second.
 */
export const cloudEvalRoutes = new Hono()
  .use("*", rateLimit({ limit: 240, windowMs: 60_000, prefix: "cloud-eval" }))
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
    const key = `${q.data.multiPv}|${fen.split(" ").slice(0, 4).join(" ")}`;
    const hit = hits.get(key);
    if (hit) return c.json(hit);
    if (misses.get(key)) return c.json({ error: "not_found" }, 404);
    try {
      const result = await fetchCloudEval(fen, q.data.multiPv);
      if (!result) {
        misses.set(key, true);
        return c.json({ error: "not_found" }, 404);
      }
      hits.set(key, result);
      c.header("Cache-Control", "public, max-age=3600");
      return c.json(result);
    } catch (e) {
      if (e instanceof LichessDataError) return c.json({ error: e.code }, e.status);
      throw e;
    }
  });
