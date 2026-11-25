// SPDX-License-Identifier: AGPL-3.0-or-later

import { Hono } from "hono";
import { z } from "zod";
import { rateLimit } from "../middleware/rate-limit";
import {
  fetchChesscomGames,
  fetchLichessGames,
  type ImportedGame,
  UpstreamError,
} from "../services/game-import";
import { TtlCache } from "../services/ttl-cache";

const params = z.object({
  source: z.enum(["lichess", "chesscom"]),
  username: z.string().regex(/^[A-Za-z0-9_-]{2,30}$/),
});
const query = z.object({ max: z.coerce.number().int().min(1).max(50).default(20) });

const cache = new TtlCache<ImportedGame[]>(10 * 60_000);

/** GET /api/import/:source/:username?max=20 — recent public games of a user. */
export const importRoutes = new Hono()
  .use("*", rateLimit({ limit: 20, windowMs: 60_000, prefix: "import" }))
  .get("/:source/:username", async (c) => {
    const p = params.safeParse(c.req.param());
    const q = query.safeParse(c.req.query());
    if (!p.success || !q.success) return c.json({ error: "invalid_request" }, 400);
    const { source, username } = p.data;
    const key = `${source}:${username.toLowerCase()}:${q.data.max}`;
    const cached = cache.get(key);
    if (cached) return c.json({ games: cached });
    try {
      const games =
        source === "lichess"
          ? await fetchLichessGames(username, q.data.max)
          : await fetchChesscomGames(username, q.data.max);
      cache.set(key, games);
      return c.json({ games });
    } catch (error) {
      if (error instanceof UpstreamError) return c.json({ error: error.code }, error.status);
      throw error;
    }
  });
