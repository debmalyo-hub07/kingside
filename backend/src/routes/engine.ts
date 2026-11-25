// SPDX-License-Identifier: AGPL-3.0-or-later

import { InvalidPositionError, normalizeFen } from "@kingside/chess-core";
import { Hono } from "hono";
import { z } from "zod";
import { readBoundedText } from "../lib/http";
import { rateLimit } from "../middleware/rate-limit";
import {
  defaultServerEngine,
  readServerEngineConfig,
  type ServerEngineConfig,
  ServerEngineError,
  type ServerEngineRunner,
} from "../services/server-engine";

const MAX_BODY_BYTES = 4096;

const evalBody = z.object({
  fen: z.string().min(10).max(100),
  nodes: z.number().int().min(1_000).max(2_000_000).optional(),
  depth: z.number().int().min(1).max(20).optional(),
  multiPv: z.number().int().min(1).max(2).default(1),
});

const statusLimit = rateLimit({ limit: 120, windowMs: 60_000, prefix: "engine-status" });
const evalLimit = rateLimit({ limit: 30, windowMs: 60_000, prefix: "engine-eval" });

export function createEngineRoutes(
  runner: ServerEngineRunner = defaultServerEngine,
  getConfig: () => ServerEngineConfig = () => readServerEngineConfig(),
) {
  return new Hono()
    .get("/status", statusLimit, (c) => {
      return c.json(runner.status(getConfig()));
    })
    .post("/eval", evalLimit, async (c) => {
      const config = getConfig();
      if (!config.enabled) {
        return c.json({ error: "engine_disabled" }, 503);
      }

      const raw = await readBoundedText(c.req.raw, MAX_BODY_BYTES);
      if (raw === "too_large") return c.json({ error: "too_large" }, 413);
      if (!raw) return c.json({ error: "invalid_request" }, 400);

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return c.json({ error: "invalid_request" }, 400);
      }
      const parsed = evalBody.safeParse(json);
      if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

      let fen: string;
      try {
        fen = normalizeFen(parsed.data.fen);
      } catch (e) {
        if (e instanceof InvalidPositionError) return c.json({ error: "invalid_fen" }, 400);
        throw e;
      }

      try {
        const result = await runner.evaluate(
          {
            fen,
            nodes: parsed.data.nodes,
            depth: parsed.data.depth,
            multiPv: parsed.data.multiPv,
          },
          config,
        );
        return c.json(result);
      } catch (e) {
        if (e instanceof ServerEngineError) {
          return c.json({ error: e.code }, e.status);
        }
        if (e instanceof InvalidPositionError) {
          return c.json({ error: "invalid_fen" }, 400);
        }
        throw e;
      }
    });
}

export const engineRoutes = createEngineRoutes();
