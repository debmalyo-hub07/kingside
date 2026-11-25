// SPDX-License-Identifier: AGPL-3.0-or-later
// Lightweight RESP2 Redis client (redis:// and rediss://) for optional sliding-window rate limiting.
// Uses only Node.js built-ins (node:net / node:tls) and degrades gracefully if Redis is unavailable.

import { connect as netConnect, type Socket } from "node:net";
import { type TLSSocket, connect as tlsConnect } from "node:tls";

type RespValue = string | number | null | RespValue[] | Error;

interface ParsedResp {
  value: RespValue;
  next: number;
}

const CONNECT_TIMEOUT_MS = 1500;
const COMMAND_TIMEOUT_MS = 1500;
const FAILURE_COOLDOWN_MS = 10_000;

/** Atomic sliding-window rate-limit check in Redis sorted sets. */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local ttl = window
  if oldest[2] then
    ttl = math.max(1, window - (now - tonumber(oldest[2])))
  end
  return {0, 0, ttl}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, limit - count - 1, 0}
`.trim();

export function encodeRespCommand(args: readonly string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const bytes = Buffer.byteLength(arg, "utf8");
    out += `$${bytes}\r\n${arg}\r\n`;
  }
  return out;
}

export function parseRespValue(buf: Buffer, offset = 0): ParsedResp | null {
  if (offset >= buf.length) return null;
  const prefix = String.fromCharCode(buf[offset] as number);
  const lineEnd = buf.indexOf("\r\n", offset + 1);
  if (lineEnd === -1) return null;
  const header = buf.toString("utf8", offset + 1, lineEnd);

  switch (prefix) {
    case "+":
      return { value: header, next: lineEnd + 2 };
    case "-":
      return { value: new Error(header), next: lineEnd + 2 };
    case ":":
      return { value: Number(header), next: lineEnd + 2 };
    case "$": {
      const len = Number(header);
      if (!Number.isInteger(len) || len < -1) {
        return { value: new Error("Invalid RESP bulk length"), next: lineEnd + 2 };
      }
      if (len === -1) return { value: null, next: lineEnd + 2 };
      const bodyStart = lineEnd + 2;
      const bodyEnd = bodyStart + len;
      if (bodyEnd + 2 > buf.length) return null;
      return { value: buf.toString("utf8", bodyStart, bodyEnd), next: bodyEnd + 2 };
    }
    case "*": {
      const count = Number(header);
      if (!Number.isInteger(count) || count < -1) {
        return { value: new Error("Invalid RESP array length"), next: lineEnd + 2 };
      }
      if (count === -1) return { value: null, next: lineEnd + 2 };
      const items: RespValue[] = [];
      let cursor = lineEnd + 2;
      for (let i = 0; i < count; i++) {
        const parsed = parseRespValue(buf, cursor);
        if (!parsed) return null;
        items.push(parsed.value);
        cursor = parsed.next;
      }
      return { value: items, next: cursor };
    }
    default:
      return { value: new Error(`Unexpected RESP prefix: ${prefix}`), next: lineEnd + 2 };
  }
}

interface PendingCommand {
  resolve: (value: RespValue) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class MinimalRedisClient {
  private readonly url: URL;
  private socket: Socket | TLSSocket | null = null;
  private connectingSocket: Socket | TLSSocket | null = null;
  private connecting: Promise<Socket | TLSSocket> | null = null;
  private rejectConnecting: ((err: Error) => void) | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private readonly pending: PendingCommand[] = [];

  constructor(redisUrl: string) {
    this.url = new URL(redisUrl);
    if (this.url.protocol !== "redis:" && this.url.protocol !== "rediss:") {
      throw new Error(`Unsupported REDIS_URL protocol: ${this.url.protocol}`);
    }
  }

  private destroySocketSafely(sock: Socket | TLSSocket | null): void {
    if (!sock) return;
    sock.removeAllListeners();
    // Keep a no-op error listener so late teardown errors cannot crash Node as unhandled 'error'.
    sock.on("error", () => undefined);
    sock.destroy();
  }

  private cleanupSocket(err?: Error): void {
    const sock = this.socket;
    const connectingSock = this.connectingSocket;
    const rejectConn = this.rejectConnecting;
    this.socket = null;
    this.connectingSocket = null;
    this.connecting = null;
    this.rejectConnecting = null;
    this.rxBuffer = Buffer.alloc(0);
    this.destroySocketSafely(sock);
    if (connectingSock && connectingSock !== sock) {
      this.destroySocketSafely(connectingSock);
    }
    const reason = err ?? new Error("Redis connection closed");
    rejectConn?.(reason);
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) {
        clearTimeout(next.timer);
        next.reject(reason);
      }
    }
  }

  private openSocket(): Promise<Socket | TLSSocket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    const host = this.url.hostname;
    const port = Number(this.url.port || 6379);
    const useTls = this.url.protocol === "rediss:";

    this.connecting = new Promise<Socket | TLSSocket>((resolve, reject) => {
      let settled = false;
      const failConnect = (err: Error) => {
        if (settled) return;
        settled = true;
        this.rejectConnecting = null;
        this.cleanupSocket(err);
        reject(err);
      };
      this.rejectConnecting = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const sock = useTls ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
      this.connectingSocket = sock;
      sock.unref?.();

      const timer = setTimeout(() => {
        failConnect(new Error(`Redis connect timeout after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);
      timer.unref?.();

      const onError = (err: Error) => {
        clearTimeout(timer);
        if (!settled) {
          failConnect(err);
        } else {
          this.cleanupSocket(err);
        }
      };

      sock.on("error", onError);
      sock.on("close", () => {
        clearTimeout(timer);
        if (!settled) {
          failConnect(new Error("Redis socket closed during handshake"));
        } else {
          this.cleanupSocket(new Error("Redis socket closed"));
        }
      });

      sock.on("data", (chunk: Buffer) => {
        this.rxBuffer = this.rxBuffer.length === 0 ? chunk : Buffer.concat([this.rxBuffer, chunk]);
        while (this.pending.length > 0) {
          const parsed = parseRespValue(this.rxBuffer, 0);
          if (!parsed) break;
          this.rxBuffer = this.rxBuffer.subarray(parsed.next);
          const item = this.pending.shift();
          if (!item) continue;
          clearTimeout(item.timer);
          if (parsed.value instanceof Error) item.reject(parsed.value);
          else item.resolve(parsed.value);
        }
      });

      sock.once(useTls ? "secureConnect" : "connect", async () => {
        clearTimeout(timer);
        if (settled) return;
        this.socket = sock;
        try {
          const password = this.url.password ? decodeURIComponent(this.url.password) : "";
          const username = this.url.username ? decodeURIComponent(this.url.username) : "";
          if (password) {
            if (username && username !== "default") {
              await this.writeCommand(sock, ["AUTH", username, password]);
            } else {
              await this.writeCommand(sock, ["AUTH", password]);
            }
          }
          const dbSegment = this.url.pathname.slice(1);
          if (dbSegment && /^\d+$/.test(dbSegment) && Number(dbSegment) > 0) {
            await this.writeCommand(sock, ["SELECT", dbSegment]);
          }
          if (settled) return;
          settled = true;
          this.connectingSocket = null;
          this.connecting = null;
          this.rejectConnecting = null;
          resolve(sock);
        } catch (err) {
          failConnect(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });

    return this.connecting;
  }

  private writeCommand(sock: Socket | TLSSocket, args: readonly string[]): Promise<RespValue> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) this.pending.splice(idx, 1);
        this.cleanupSocket(new Error(`Redis command timeout after ${COMMAND_TIMEOUT_MS}ms`));
        reject(new Error(`Redis command timeout after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
      timer.unref?.();
      this.pending.push({ resolve, reject, timer });
      sock.write(encodeRespCommand(args));
    });
  }

  async command(args: readonly string[]): Promise<RespValue> {
    const sock = await this.openSocket();
    return this.writeCommand(sock, args);
  }

  async close(): Promise<void> {
    this.cleanupSocket(new Error("Redis client closed"));
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
  close?(): Promise<void>;
}

/**
 * Redis-backed sliding-window store with automatic circuit-breaker fallback to an in-memory store
 * if Redis is temporarily unreachable or errors.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: MinimalRedisClient;
  private unhealthyUntil = 0;
  private loggedWarning = false;
  private seq = 0;

  constructor(
    redisUrl: string,
    private readonly fallback: RateLimitStore,
    client?: MinimalRedisClient,
  ) {
    this.client = client ?? new MinimalRedisClient(redisUrl);
  }

  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    if (now < this.unhealthyUntil) {
      return this.fallback.consume(key, limit, windowMs, now);
    }
    try {
      const member = `${now}-${process.pid}-${++this.seq}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await this.client.command([
        "EVAL",
        SLIDING_WINDOW_LUA,
        "1",
        key,
        String(now),
        String(windowMs),
        String(limit),
        member,
      ]);
      if (!Array.isArray(res) || res.length < 3) {
        throw new Error("Unexpected Redis EVAL response");
      }
      this.loggedWarning = false;
      const allowed = Number(res[0]) === 1;
      const remaining = Math.max(0, Number(res[1]) || 0);
      const retryMs = Math.max(0, Number(res[2]) || 0);
      return {
        allowed,
        remaining,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryMs / 1000)),
      };
    } catch (error) {
      this.unhealthyUntil = now + FAILURE_COOLDOWN_MS;
      if (!this.loggedWarning) {
        this.loggedWarning = true;
        console.warn("rate-limit: Redis unavailable, falling back to in-memory store:", error);
      }
      return this.fallback.consume(key, limit, windowMs, now);
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
