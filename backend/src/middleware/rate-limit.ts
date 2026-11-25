// SPDX-License-Identifier: AGPL-3.0-or-later
// Sliding-window rate limit per client IP with hardened proxy-header parsing, bounded LRU in-memory
// storage, and optional REDIS_URL-backed store with safe fallback.

import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import {
  type RateLimitDecision,
  type RateLimitStore,
  RedisRateLimitStore,
} from "../services/redis-rate-limit";

const DEFAULT_MAX_KEYS = 10_000;

function normalizeIp(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return undefined;
  const unmapped = trimmed.toLowerCase().startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  return isIP(unmapped) !== 0 ? unmapped : undefined;
}

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;

  const parts = normalized.split(".");
  if (parts.length !== 4) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / internal VPC
  return false;
}

function getRemoteAddress(c: Context): string | undefined {
  try {
    const raw = getConnInfo(c).remote.address;
    return raw ? normalizeIp(raw) : undefined;
  } catch {
    return undefined;
  }
}

function shouldTrustProxyHeaders(remoteAddr: string | undefined): boolean {
  const override = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (override === "false") return false;
  if (override === "true") return true;
  if (remoteAddr) return isPrivateOrLoopbackIp(remoteAddr);
  // In serverless platforms (e.g. Vercel), socket conninfo is absent and platform edge headers are authoritative.
  return process.env.VERCEL === "1";
}

function pickRightmostValidIp(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const candidates = headerValue
    .split(",")
    .map((part) => normalizeIp(part))
    .filter((ip): ip is string => Boolean(ip));
  if (candidates.length === 0) return undefined;
  // Walk right-to-left: skip internal proxy hops to find the real client IP appended by our edge proxy,
  // ignoring any spoofed leftmost client-supplied hops.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i] as string;
    if (!isPrivateOrLoopbackIp(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

export function clientIp(c: Context): string {
  const remoteAddr = getRemoteAddress(c);
  if (!shouldTrustProxyHeaders(remoteAddr)) {
    return remoteAddr ?? "unknown";
  }

  // Platform-specific edge headers take precedence only on the platform that sets & strips them,
  // so attackers cannot spoof arbitrary CF-Connecting-IP / X-Real-IP headers through other proxies.
  if (process.env.VERCEL === "1") {
    const vercelFwd = pickRightmostValidIp(c.req.header("x-vercel-forwarded-for"));
    if (vercelFwd) return vercelFwd;
  } else if (process.env.RENDER === "true" || process.env.RENDER_SERVICE_ID) {
    for (const raw of [c.req.header("cf-connecting-ip"), c.req.header("true-client-ip")]) {
      const ip = raw ? normalizeIp(raw) : undefined;
      if (ip) return ip;
    }
  }

  const xff = pickRightmostValidIp(c.req.header("x-forwarded-for"));
  if (xff) return xff;

  const xRealIp = c.req.header("x-real-ip");
  const normalizedRealIp = xRealIp ? normalizeIp(xRealIp) : undefined;
  if (normalizedRealIp) return normalizedRealIp;

  return remoteAddr ?? "unknown";
}

interface Bucket {
  timestamps: number[];
  expiresAt: number;
}

/**
 * Hardened bounded in-memory sliding-window store.
 * Evicts expired entries first, then oldest-touched keys (LRU), never clearing the whole map.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, Bucket>();

  constructor(private readonly maxKeys = DEFAULT_MAX_KEYS) {}

  get size(): number {
    return this.hits.size;
  }

  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    const existing = this.hits.get(key);
    const recent = existing ? existing.timestamps.filter((t) => now - t < windowMs) : [];

    if (recent.length >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - (recent[0] ?? now))) / 1000));
      this.hits.delete(key);
      this.hits.set(key, {
        timestamps: recent,
        expiresAt: (recent[recent.length - 1] ?? now) + windowMs,
      });
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, { timestamps: recent, expiresAt: now + windowMs });

    if (this.hits.size > this.maxKeys) {
      for (const [k, bucket] of this.hits) {
        if (bucket.expiresAt <= now) this.hits.delete(k);
      }
      while (this.hits.size > this.maxKeys) {
        const oldest = this.hits.keys().next().value;
        if (oldest === undefined) break;
        this.hits.delete(oldest);
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - recent.length),
      retryAfterSeconds: 0,
    };
  }
}

let cachedRedisUrl = "";
let cachedRedisStore: RedisRateLimitStore | null = null;
const sharedMemoryStore = new MemoryRateLimitStore();
let anonymousPrefixSeq = 0;

export function createRateLimitStore(
  redisUrl?: string,
  fallback: RateLimitStore = sharedMemoryStore,
): RateLimitStore {
  const trimmed = redisUrl?.trim();
  if (!trimmed) return fallback;
  try {
    return new RedisRateLimitStore(trimmed, fallback);
  } catch (error) {
    console.warn("rate-limit: invalid REDIS_URL, using in-memory fallback:", error);
    return fallback;
  }
}

function defaultStore(): RateLimitStore {
  const url = process.env.REDIS_URL?.trim() ?? "";
  if (!url) return sharedMemoryStore;
  if (cachedRedisUrl === url) return cachedRedisStore ?? sharedMemoryStore;
  void cachedRedisStore?.close();
  cachedRedisUrl = url;
  const created = createRateLimitStore(url, sharedMemoryStore);
  cachedRedisStore = created instanceof RedisRateLimitStore ? created : null;
  return created;
}

export async function resetRateLimitStores(): Promise<void> {
  await cachedRedisStore?.close();
  cachedRedisStore = null;
  cachedRedisUrl = "";
}

export function rateLimit({
  limit,
  windowMs,
  prefix,
  store,
}: {
  limit: number;
  windowMs: number;
  prefix?: string;
  store?: RateLimitStore;
}): MiddlewareHandler {
  const keyPrefix = prefix ?? `rl${++anonymousPrefixSeq}`;
  const localMemory = store ? null : new MemoryRateLimitStore();

  return async (c, next) => {
    const ip = clientIp(c);
    const activeStore =
      store ?? (process.env.REDIS_URL?.trim() ? defaultStore() : (localMemory as RateLimitStore));
    const key = `ks:rl:${keyPrefix}:${ip}`;
    const result = await activeStore.consume(key, limit, windowMs);
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return c.json({ error: "rate_limited" }, 429);
    }
    await next();
  };
}
