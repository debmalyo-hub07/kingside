// SPDX-License-Identifier: AGPL-3.0-or-later

import { serve } from "@hono/node-server";
import { connectDb, disconnectDb } from "@kingside/db";
import { createApp } from "./app";
import { readEnv } from "./env";
import { resetRateLimitStores } from "./middleware/rate-limit";
import { shutdownServerEngine } from "./services/server-engine";

const env = readEnv();
const app = createApp(env);

// Pre-warm MongoDB connection in the background without blocking or crashing startup.
if (process.env.MONGODB_URI?.trim()) {
  void connectDb().catch((error) => {
    console.error("startup: initial MongoDB connection failed (will retry on demand):", error);
  });
}

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`Kingside API listening on http://0.0.0.0:${info.port}`);
});

async function shutdown() {
  server.close();
  await Promise.allSettled([shutdownServerEngine(), disconnectDb(), resetRateLimitStores()]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
