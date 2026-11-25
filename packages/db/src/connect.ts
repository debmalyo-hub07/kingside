// SPDX-License-Identifier: AGPL-3.0-or-later

import mongoose from "mongoose";
import { readDbEnv } from "./env";

// NoSQL-injection guards; see CLAUDE.md §9.
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

type Cache = { promise: Promise<typeof mongoose> | null };

// One connection per process, survives Next.js dev hot reload and serverless re-invocations.
const globalCache = globalThis as typeof globalThis & { __kingsideMongo?: Cache };
const cache: Cache = globalCache.__kingsideMongo ?? { promise: null };
globalCache.__kingsideMongo = cache;

export function connectDb(): Promise<typeof mongoose> {
  if (!cache.promise) {
    const env = readDbEnv();
    cache.promise = mongoose
      .connect(env.MONGODB_URI, {
        dbName: env.MONGODB_DB,
        autoIndex: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
      })
      .catch((error: unknown) => {
        cache.promise = null;
        throw error;
      });
  }
  return cache.promise;
}

export async function disconnectDb(): Promise<void> {
  if (cache.promise) {
    await mongoose.disconnect();
    cache.promise = null;
  }
}
