// SPDX-License-Identifier: AGPL-3.0-or-later
// Typed backend environment variables.

import { z } from "zod";

const optionalBooleanFlag = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const norm = value?.trim().toLowerCase() ?? "";
      if (norm === "") return defaultValue;
      if (norm === "true" || norm === "1") return true;
      if (norm === "false" || norm === "0") return false;
      return norm;
    })
    .refine((value): value is boolean => typeof value === "boolean", {
      message: 'must be "true", "false", or empty',
    });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  /** Comma-separated list of allowed frontend origins for CORS (supports exact URLs and project-scoped wildcards like https://kingsidechess-*.vercel.app). */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,https://kingsidechess.vercel.app,https://kingsidechess-*.vercel.app")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    ),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Optional Redis/Valkey/Upstash URL for shared rate limiting. Falls back to hardened in-memory when blank. */
  REDIS_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Optional proxy trust override ("true" / "false"). Defaults to auto-detecting private/loopback proxy peers. */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => {
      const norm = value?.trim().toLowerCase() ?? "";
      return norm === "true" ? true : norm === "false" ? false : norm === "" ? undefined : norm;
    })
    .refine((value) => value === undefined || typeof value === "boolean", {
      message: 'TRUST_PROXY must be "true", "false", or empty',
    }),
  /** Enables native server-side Stockfish fallback (/api/engine/eval) when true. */
  SERVER_ENGINE_ENABLED: optionalBooleanFlag(false),
  /** Optional explicit path to native Stockfish binary. */
  STOCKFISH_BIN: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /** Stockfish hash table cap in MB (clamped 16-32 MB at runtime for Render Free 512 MB RAM safety). */
  SERVER_ENGINE_HASH_MB: z.coerce.number().int().min(8).max(64).default(16),
  /** Maximum node budget allowed per /api/engine/eval request. */
  SERVER_ENGINE_MAX_NODES: z.coerce.number().int().min(10_000).max(2_000_000).default(400_000),
  /** Maximum pending queue depth before rejecting with 503 engine_busy. */
  SERVER_ENGINE_MAX_QUEUE: z.coerce.number().int().min(1).max(16).default(4),
  /** Maximum per-evaluation execution timeout in ms. */
  SERVER_ENGINE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
});

export type Env = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid backend env: ${z.prettifyError(parsed.error)}\nSee backend/.env.example.`);
  }
  return parsed.data;
}
