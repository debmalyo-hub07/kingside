// SPDX-License-Identifier: AGPL-3.0-or-later

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./env";
import { cloudEvalRoutes } from "./routes/cloud-eval";
import { engineRoutes } from "./routes/engine";
import { evalCacheRoutes } from "./routes/eval-cache";
import { explorerRoutes } from "./routes/explorer";
import { healthRoutes } from "./routes/health";
import { importRoutes } from "./routes/import";
import { puzzleRoutes } from "./routes/puzzles";
import { shareRoutes } from "./routes/share";
import { tablebaseRoutes } from "./routes/tablebase";

const ORIGIN_PATTERN_RE = /^(https?):\/\/([^/:?#]+)(?::(\d+|\*))?$/i;

/**
 * Checks whether an incoming HTTP Origin header matches the configured allowed origin patterns.
 * Parses the origin strictly as a URL (rejecting paths, queries, userinfo, and non-HTTP schemes)
 * and restricts host wildcards (`*`) to single DNS-label characters (`[a-z0-9-]+`).
 */
export function isAllowedOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin || parsed.username || parsed.password) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port;

  return allowedOrigins.some((rawPattern) => {
    const pattern = rawPattern.trim().replace(/\/+$/, "");
    if (!pattern) return false;
    if (pattern === "*") return true;
    if (pattern.toLowerCase() === origin.toLowerCase()) return true;

    const match = ORIGIN_PATTERN_RE.exec(pattern);
    if (!match) return false;
    const [, pScheme, pHost, pPort] = match;
    if (!pScheme || !pHost || pScheme.toLowerCase() !== scheme) return false;

    if (pPort === undefined) {
      if (port !== "") return false;
    } else if (pPort !== "*") {
      const normalizedPatternPort =
        (scheme === "http" && pPort === "80") || (scheme === "https" && pPort === "443") ? "" : pPort;
      if (port !== normalizedPatternPort) return false;
    }

    const hostPattern = pHost.toLowerCase();
    if (!hostPattern.includes("*")) return host === hostPattern;

    const hostRegexSrc = hostPattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[a-z0-9-]+");
    return new RegExp(`^${hostRegexSrc}$`).test(host);
  });
}

export function createApp(env: Pick<Env, "CORS_ORIGINS">) {
  const app = new Hono();

  app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin, env.CORS_ORIGINS) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );

  // Root status endpoint for platform verification
  app.get("/", (c) =>
    c.json({
      name: "Kingside API",
      status: "ok",
      health: "/api/health",
      ready: "/api/health/ready",
    }),
  );

  // Health routes mounted on /api/health and aliased at /health
  app.route("/api/health", healthRoutes);
  app.route("/health", healthRoutes);

  // API feature routes
  app.route("/api/import", importRoutes);
  app.route("/api/puzzles", puzzleRoutes);
  app.route("/api/explorer", explorerRoutes);
  app.route("/api/tablebase", tablebaseRoutes);
  app.route("/api/cloud-eval", cloudEvalRoutes);
  app.route("/api/eval-cache", evalCacheRoutes);
  app.route("/api/engine", engineRoutes);
  app.route("/api/share", shareRoutes);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
