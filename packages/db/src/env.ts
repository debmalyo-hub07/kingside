// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

const envSchema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// URI"),
  MONGODB_DB: z.string().min(1).default("kingside"),
});

export type DbEnv = z.infer<typeof envSchema>;

/** Reads and validates DB env vars. Throws a readable error when missing. */
export function readDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid database env: ${z.prettifyError(parsed.error)}\nSee backend/.env.example.`);
  }
  return parsed.data;
}
