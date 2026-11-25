// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  InvalidPositionError,
  MOVE_CLASSES,
  mainlineLength,
  treeFromPgn,
  treeToPgn,
} from "@kingside/chess-core";
import { connectDb, createSharedGame, getSharedGame, SHARE_ID } from "@kingside/db";
import { Hono } from "hono";
import { z } from "zod";
import { readBoundedText } from "../lib/http";
import { rateLimit } from "../middleware/rate-limit";

const MAX_PLIES = 1000;
/** Whole stored document stays far below MongoDB's 16 MB limit (CLAUDE.md §7). */
const MAX_DOC_BYTES = 1_000_000;

const accuracy = z.number().finite().min(0).max(100).nullable();

const body = z.object({
  pgn: z.string().min(1).max(200_000),
  ownerDeviceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  orientation: z.enum(["white", "black"]).default("white"),
  analysis: z
    .object({
      whiteWin: z
        .array(z.number().finite().min(0).max(100))
        .max(MAX_PLIES + 1)
        .transform((a) => a.map((v) => Math.round(v * 10) / 10)),
      classes: z.array(z.enum(MOVE_CLASSES as [string, ...string[]])).max(MAX_PLIES),
      accuracy: z.object({ white: accuracy, black: accuracy }),
    })
    .nullable()
    .default(null),
});

const postLimit = rateLimit({ limit: 10, windowMs: 60_000, prefix: "share-post" });
const getLimit = rateLimit({ limit: 120, windowMs: 60_000, prefix: "share-get" });

/**
 * POST /api/share { pgn, ownerDeviceId, orientation?, analysis? } → { id }   (link: /g/<id>, kept 1 year)
 * GET  /api/share/:id → { id, pgn, analysis, orientation, createdAt }
 */
export const shareRoutes = new Hono()
  .post("/", postLimit, async (c) => {
    const raw = await readBoundedText(c.req.raw, MAX_DOC_BYTES);
    if (raw === "too_large") return c.json({ error: "too_large" }, 413);
    if (!raw) return c.json({ error: "invalid_request" }, 400);

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const parsed = body.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const { analysis, orientation, ownerDeviceId } = parsed.data;

    let pgn: string;
    let plies: number;
    try {
      const tree = treeFromPgn(parsed.data.pgn);
      plies = mainlineLength(tree);
      pgn = treeToPgn(tree);
    } catch (e) {
      if (e instanceof InvalidPositionError) return c.json({ error: "invalid_pgn" }, 400);
      throw e;
    }
    if (plies > MAX_PLIES) return c.json({ error: "too_many_moves" }, 400);
    if (analysis && (analysis.whiteWin.length !== plies + 1 || analysis.classes.length !== plies)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (
      Buffer.byteLength(pgn, "utf8") + Buffer.byteLength(JSON.stringify(analysis), "utf8") >
      MAX_DOC_BYTES
    ) {
      return c.json({ error: "too_large" }, 413);
    }

    await connectDb();
    const id = await createSharedGame({ pgn, analysis, orientation, ownerDeviceId });
    return c.json({ id }, 201);
  })
  .get("/:id", getLimit, async (c) => {
    const id = c.req.param("id");
    if (!SHARE_ID.test(id)) return c.json({ error: "invalid_request" }, 400);
    await connectDb();
    const game = await getSharedGame(id);
    if (!game) return c.json({ error: "not_found" }, 404);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(game);
  });
