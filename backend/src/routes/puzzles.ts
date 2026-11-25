// SPDX-License-Identifier: AGPL-3.0-or-later

import { connectDb, dailyPuzzle, getPuzzle, nextPuzzle, utcDate } from "@kingside/db";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit } from "../middleware/rate-limit";

const PUZZLE_ID = /^[A-Za-z0-9]{5,8}$/;
const THEME = /^[A-Za-z0-9]{2,32}$/;

const nextQuery = z.object({
  rating: z.coerce.number().int().min(400).max(3500).default(1500),
  theme: z.string().regex(THEME).optional(),
  exclude: z
    .string()
    .max(600)
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .filter((id) => PUZZLE_ID.test(id))
            .slice(0, 60)
        : [],
    ),
});

/**
 * GET /api/puzzles/next?rating=&theme=&exclude=id,id   random puzzle near a rating
 * GET /api/puzzles/daily                                today's puzzle (UTC)
 * GET /api/puzzles/:id                                  one puzzle
 * Puzzle data: Lichess puzzle database (CC0).
 */
export const puzzleRoutes = new Hono()
  .use("*", rateLimit({ limit: 120, windowMs: 60_000, prefix: "puzzles" }))
  .get("/next", async (c) => {
    const q = nextQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "invalid_request" }, 400);
    await connectDb();
    const puzzle = await nextPuzzle({
      rating: q.data.rating,
      exclude: q.data.exclude,
      ...(q.data.theme ? { theme: q.data.theme } : {}),
    });
    return puzzle ? c.json({ puzzle }) : c.json({ error: "no_puzzle" }, 404);
  })
  .get("/daily", async (c) => {
    const date = utcDate();
    await connectDb();
    const puzzle = await dailyPuzzle(date);
    if (!puzzle) return c.json({ error: "no_puzzle" }, 404);
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ date, puzzle });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!PUZZLE_ID.test(id)) return c.json({ error: "invalid_request" }, 400);
    await connectDb();
    const puzzle = await getPuzzle(id);
    return puzzle ? c.json({ puzzle }) : c.json({ error: "not_found" }, 404);
  });
