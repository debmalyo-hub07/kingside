// SPDX-License-Identifier: AGPL-3.0-or-later

import { connectDb } from "@kingside/db";
import { Hono } from "hono";
import { rateLimit } from "../middleware/rate-limit";

/** Database ping timeout threshold (ms). Keeps health checks well below Render's 5s timeout. */
const DB_CHECK_TIMEOUT_MS = 2500;

async function pingDatabase(): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database health check timed out after ${DB_CHECK_TIMEOUT_MS}ms`)),
      DB_CHECK_TIMEOUT_MS,
    );
    timer.unref?.();
  });

  try {
    const checkPromise = (async () => {
      const mongoose = await connectDb();
      if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
        throw new Error(`MongoDB connection is not ready (readyState: ${mongoose.connection.readyState})`);
      }
      await mongoose.connection.db.admin().ping();
    })();

    await Promise.race([checkPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabaseStatus() {
  const uptime = process.uptime();
  const timestamp = new Date().toISOString();

  if (!process.env.MONGODB_URI?.trim()) {
    return {
      ready: false,
      configured: false,
      payload: {
        status: "ok",
        uptime,
        timestamp,
        mongo: "unconfigured",
        ok: true,
        db: "unconfigured",
      },
    };
  }

  try {
    await pingDatabase();
    return {
      ready: true,
      configured: true,
      payload: {
        status: "ok",
        uptime,
        timestamp,
        mongo: "connected",
        ok: true,
        db: "up",
      },
    };
  } catch (error) {
    console.error("health: db ping failed", error);
    return {
      ready: false,
      configured: true,
      payload: {
        status: "degraded",
        uptime,
        timestamp,
        mongo: "disconnected",
        ok: false,
        db: "down",
      },
    };
  }
}

/**
 * Liveness (`GET /api/health`) and strict readiness (`GET /api/health/ready`) endpoints.
 * - `/` returns 200 OK even in degraded DB state so Render liveness probes avoid restart loops.
 * - `/ready` returns 200 OK only when MongoDB is connected and responsive, or 503 Service Unavailable.
 */
export const healthRoutes = new Hono()
  .use("*", rateLimit({ limit: 120, windowMs: 60_000, prefix: "health" }))
  .get("/", async (c) => {
    const result = await checkDatabaseStatus();
    return c.json(result.payload);
  })
  .get("/ready", async (c) => {
    const result = await checkDatabaseStatus();
    if (!result.ready) {
      return c.json(
        {
          ...result.payload,
          status: "degraded",
          ok: false,
        },
        503,
      );
    }
    return c.json(result.payload, 200);
  });
