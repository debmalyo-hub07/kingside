// SPDX-License-Identifier: AGPL-3.0-or-later
// Serialized single-worker native Stockfish UCI runner for mobile/WASM fallback (/api/engine/eval).
// Designed for Render Free (512 MB RAM): non-shell spawn, Threads=1, Hash clamped 16-32 MB,
// bounded node/timeout limits, strict queue cap, and clean SIGTERM teardown.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { type EngineLine, normalizeFen, positionFromFen } from "@kingside/chess-core";
import { parseInfoLine } from "@kingside/uci";

export const SERVER_ENGINE_NAME = "Stockfish 19 NNUE";
export const SERVER_ENGINE_MAX_MULTIPV = 2;

const STOCKFISH_19_ID_RE = /\bStockfish(?:\.js)?\s+19(?:\b|\.)/i;
const DEFAULT_CANDIDATE_BINS = ["/usr/local/bin/stockfish", "/usr/games/stockfish", "/usr/bin/stockfish"];

const IDLE_REAP_MS = 5 * 60_000;

export class ServerEngineError extends Error {
  constructor(
    readonly code: "engine_disabled" | "engine_unavailable" | "engine_busy" | "engine_timeout",
    readonly status: 503,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface ServerEngineConfig {
  enabled: boolean;
  binPath?: string | undefined;
  hashMb: number;
  maxNodes: number;
  maxQueue: number;
  timeoutMs: number;
}

export interface ServerEvalRequest {
  fen: string;
  nodes?: number | undefined;
  depth?: number | undefined;
  multiPv?: number | undefined;
}

export interface ServerEvalResult {
  fen: string;
  engine: string;
  depth: number;
  multipv: number;
  nodes?: number | undefined;
  lines: EngineLine[];
}

export interface ServerEngineStatus {
  enabled: boolean;
  available: boolean;
  maxNodes: number;
  maxMultiPv: number;
  maxQueue: number;
  queued: number;
}

export function clampServerHashMb(hashMb: number): number {
  if (!Number.isFinite(hashMb)) return 16;
  return Math.max(16, Math.min(32, Math.floor(hashMb)));
}

export function readServerEngineConfig(source: NodeJS.ProcessEnv = process.env): ServerEngineConfig {
  const flag = source.SERVER_ENGINE_ENABLED?.trim().toLowerCase() ?? "";
  const enabled = flag === "true" || flag === "1";
  const binPath = source.STOCKFISH_BIN?.trim() || undefined;
  const hashRaw = Number(source.SERVER_ENGINE_HASH_MB);
  const maxNodesRaw = Number(source.SERVER_ENGINE_MAX_NODES);
  const maxQueueRaw = Number(source.SERVER_ENGINE_MAX_QUEUE);
  const timeoutRaw = Number(source.SERVER_ENGINE_TIMEOUT_MS);

  return {
    enabled,
    binPath,
    hashMb: clampServerHashMb(Number.isFinite(hashRaw) && hashRaw > 0 ? hashRaw : 16),
    maxNodes:
      Number.isFinite(maxNodesRaw) && maxNodesRaw >= 10_000
        ? Math.min(2_000_000, Math.floor(maxNodesRaw))
        : 400_000,
    maxQueue: Number.isFinite(maxQueueRaw) && maxQueueRaw >= 1 ? Math.min(16, Math.floor(maxQueueRaw)) : 4,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 ? Math.min(60_000, Math.floor(timeoutRaw)) : 15_000,
  };
}

function isExecutableFile(p: string): boolean {
  try {
    if (!existsSync(p)) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveStockfishBinary(explicitPath?: string): string | null {
  if (explicitPath) {
    if (explicitPath.includes("/") || explicitPath.includes("\\")) {
      return isExecutableFile(explicitPath) ? explicitPath : null;
    }
    return explicitPath;
  }
  for (const candidate of DEFAULT_CANDIDATE_BINS) {
    if (isExecutableFile(candidate)) return candidate;
  }
  const pathDirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);
  const names = process.platform === "win32" ? ["stockfish.exe", "stockfish"] : ["stockfish"];
  for (const dir of pathDirs) {
    for (const name of names) {
      const full = `${dir}${process.platform === "win32" ? "\\" : "/"}${name}`;
      if (isExecutableFile(full)) return full;
    }
  }
  return null;
}

type SpawnFn = (bin: string, args: readonly string[]) => ChildProcessWithoutNullStreams;

interface PendingJob {
  fen: string;
  nodes: number;
  depth?: number | undefined;
  multiPv: number;
  resolve: (res: ServerEvalResult) => void;
  reject: (err: unknown) => void;
}

export class ServerEngineRunner {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private rejectReadyInit: ((err: ServerEngineError) => void) | null = null;
  private readyHashMb = 16;
  private readyBin: string | null = null;
  private uciIdName: string | null = null;
  private stdoutBuf = "";
  private initializingJob: PendingJob | null = null;
  private activeJob: {
    job: PendingJob;
    lines: Map<number, EngineLine>;
    turn: "white" | "black";
    timer: NodeJS.Timeout;
    killTimer?: NodeJS.Timeout | undefined;
    timedOut: boolean;
  } | null = null;
  private queue: PendingJob[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(
    private readonly spawnProc: SpawnFn = (bin, args) =>
      spawn(bin, [...args], { stdio: ["pipe", "pipe", "pipe"], shell: false }),
    private readonly resolveBin: (explicit?: string) => string | null = resolveStockfishBinary,
  ) {}

  status(config: ServerEngineConfig): ServerEngineStatus {
    const bin = config.enabled ? this.resolveBin(config.binPath) : null;
    return {
      enabled: config.enabled,
      available: config.enabled && bin !== null,
      maxNodes: config.maxNodes,
      maxMultiPv: SERVER_ENGINE_MAX_MULTIPV,
      maxQueue: config.maxQueue,
      queued: this.queue.length + (this.activeJob ? 1 : 0) + (this.initializingJob ? 1 : 0),
    };
  }

  async evaluate(req: ServerEvalRequest, config: ServerEngineConfig): Promise<ServerEvalResult> {
    if (!config.enabled || this.shuttingDown) {
      throw new ServerEngineError("engine_disabled", 503);
    }
    const normalizedFen = normalizeFen(req.fen);
    if (/[\r\n]/.test(normalizedFen)) {
      throw new Error("Invalid normalized FEN");
    }

    const pos = positionFromFen(normalizedFen);
    if (pos.isEnd()) {
      return {
        fen: normalizedFen,
        engine: this.uciIdName ? this.resolvedEngineName() : SERVER_ENGINE_NAME,
        depth: 0,
        multipv: 1,
        lines: [],
      };
    }

    const bin = this.resolveBin(config.binPath);
    if (!bin) {
      throw new ServerEngineError("engine_unavailable", 503);
    }

    const pendingTotal = this.queue.length + (this.activeJob ? 1 : 0) + (this.initializingJob ? 1 : 0);
    if (pendingTotal >= config.maxQueue) {
      throw new ServerEngineError("engine_busy", 503);
    }

    const multiPv = Math.max(1, Math.min(SERVER_ENGINE_MAX_MULTIPV, req.multiPv ?? 1));
    const requestedNodes = req.nodes ?? Math.min(200_000, config.maxNodes);
    const nodes = Math.max(1_000, Math.min(config.maxNodes, Math.floor(requestedNodes)));
    const depth = req.depth !== undefined ? Math.max(1, Math.min(20, Math.floor(req.depth))) : undefined;

    return new Promise<ServerEvalResult>((resolve, reject) => {
      this.queue.push({ fen: normalizedFen, nodes, depth, multiPv, resolve, reject });
      void this.pump(bin, config);
    });
  }

  private async pump(bin: string, config: ServerEngineConfig): Promise<void> {
    if (this.activeJob || this.initializingJob || this.queue.length === 0) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    const job = this.queue.shift();
    if (!job) return;
    this.initializingJob = job;

    try {
      await this.ensureWorker(bin, config);
    } catch (err) {
      this.initializingJob = null;
      job.reject(
        err instanceof ServerEngineError
          ? err
          : new ServerEngineError("engine_unavailable", 503, (err as Error)?.message),
      );
      void this.pump(bin, config);
      return;
    }
    this.initializingJob = null;

    if (this.shuttingDown) {
      job.reject(new ServerEngineError("engine_disabled", 503));
      return;
    }

    const child = this.child;
    if (!child || child.killed) {
      job.reject(new ServerEngineError("engine_unavailable", 503));
      void this.pump(bin, config);
      return;
    }

    const turn = job.fen.split(" ")[1] === "b" ? "black" : "white";
    const timer = setTimeout(() => {
      const current = this.activeJob;
      if (!current || current.job !== job) return;
      current.timedOut = true;
      try {
        child.stdin.write("stop\n");
      } catch {
        // Ignore broken pipe
      }
      current.killTimer = setTimeout(() => {
        if (this.activeJob?.job !== job) return;
        this.destroyWorker(new ServerEngineError("engine_timeout", 503));
      }, 300);
      current.killTimer.unref?.();
    }, config.timeoutMs);
    timer.unref?.();

    this.activeJob = {
      job,
      lines: new Map(),
      turn,
      timer,
      timedOut: false,
    };

    try {
      child.stdin.write(`setoption name MultiPV value ${job.multiPv}\n`);
      child.stdin.write(`position fen ${job.fen}\n`);
      child.stdin.write(job.depth !== undefined ? `go depth ${job.depth}\n` : `go nodes ${job.nodes}\n`);
    } catch {
      this.destroyWorker(new ServerEngineError("engine_unavailable", 503));
    }
  }

  private ensureWorker(bin: string, config: ServerEngineConfig): Promise<void> {
    const hashMb = clampServerHashMb(config.hashMb);
    if (this.child && !this.child.killed && this.readyPromise) {
      if (this.readyBin === bin) {
        if (this.readyHashMb !== hashMb) {
          this.readyHashMb = hashMb;
          try {
            this.child.stdin.write(`setoption name Hash value ${hashMb}\n`);
          } catch {
            this.destroyWorker(new ServerEngineError("engine_unavailable", 503));
            return this.ensureWorker(bin, config);
          }
        }
        return this.readyPromise;
      }
      this.destroyWorker(new ServerEngineError("engine_unavailable", 503));
    }

    this.stdoutBuf = "";
    this.readyHashMb = hashMb;
    this.readyBin = null;
    this.uciIdName = null;

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = this.spawnProc(bin, []);
    } catch (err) {
      return Promise.reject(new ServerEngineError("engine_unavailable", 503, (err as Error)?.message));
    }

    this.readyBin = bin;
    this.child = proc;

    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      let settled = false;
      let uciSeen = false;

      const initTimer = setTimeout(
        () => {
          if (settled) return;
          settled = true;
          this.destroyWorker(new ServerEngineError("engine_timeout", 503));
          rejectReady(new ServerEngineError("engine_timeout", 503));
        },
        Math.min(config.timeoutMs, 10_000),
      );
      initTimer.unref?.();

      const failInit = (err: ServerEngineError) => {
        if (!settled) {
          settled = true;
          clearTimeout(initTimer);
          if (this.rejectReadyInit === failInit) this.rejectReadyInit = null;
          rejectReady(err);
        }
      };
      this.rejectReadyInit = failInit;

      proc.stdout.on("data", (chunk: Buffer) => {
        this.stdoutBuf += chunk.toString("utf8");
        const lines = this.stdoutBuf.split(/\r?\n/);
        this.stdoutBuf = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          if (!uciSeen && line.startsWith("id name ")) {
            const parsedName = line.slice("id name ".length).trim();
            if (parsedName) this.uciIdName = parsedName;
            continue;
          }

          if (!uciSeen && line === "uciok") {
            uciSeen = true;
            try {
              proc.stdin.write("setoption name Threads value 1\n");
              proc.stdin.write(`setoption name Hash value ${hashMb}\n`);
              proc.stdin.write("isready\n");
            } catch {
              failInit(new ServerEngineError("engine_unavailable", 503));
              this.destroyWorker(new ServerEngineError("engine_unavailable", 503));
            }
            continue;
          }

          if (!settled && line === "readyok") {
            settled = true;
            clearTimeout(initTimer);
            if (this.rejectReadyInit === failInit) this.rejectReadyInit = null;
            resolveReady();
            continue;
          }

          const active = this.activeJob;
          if (!active) continue;

          if (line.startsWith("info")) {
            const parsed = parseInfoLine(line, active.turn);
            if (parsed) {
              active.lines.set(parsed.multipv, {
                pv: parsed.pv,
                score: parsed.score,
                depth: parsed.depth,
              });
            }
            continue;
          }

          if (line.startsWith("bestmove")) {
            clearTimeout(active.timer);
            if (active.killTimer) clearTimeout(active.killTimer);
            const sorted = [...active.lines.entries()]
              .sort((a, b) => a[0] - b[0])
              .slice(0, active.job.multiPv)
              .map(([, l]) => l);
            this.activeJob = null;
            if (sorted.length === 0) {
              active.job.reject(
                new ServerEngineError(active.timedOut ? "engine_timeout" : "engine_unavailable", 503),
              );
            } else {
              active.job.resolve({
                fen: active.job.fen,
                engine: this.resolvedEngineName(),
                depth: sorted[0]?.depth ?? 0,
                multipv: active.job.multiPv,
                ...(active.job.depth === undefined ? { nodes: active.job.nodes } : {}),
                lines: sorted,
              });
            }
            this.scheduleIdleReap();
            void this.pump(bin, config);
          }
        }
      });

      proc.on("error", () => {
        const err = new ServerEngineError("engine_unavailable", 503);
        failInit(err);
        this.destroyWorker(err);
      });

      proc.on("exit", () => {
        const err = new ServerEngineError("engine_unavailable", 503);
        failInit(err);
        if (this.child === proc) {
          this.child = null;
          this.readyPromise = null;
          this.readyBin = null;
          this.uciIdName = null;
        }
        if (this.activeJob) {
          const active = this.activeJob;
          this.activeJob = null;
          clearTimeout(active.timer);
          if (active.killTimer) clearTimeout(active.killTimer);
          active.job.reject(err);
          void this.pump(bin, config);
        }
      });

      try {
        proc.stdin.write("uci\n");
      } catch {
        failInit(new ServerEngineError("engine_unavailable", 503));
        this.destroyWorker(new ServerEngineError("engine_unavailable", 503));
      }
    });

    this.readyPromise.catch(() => undefined);
    return this.readyPromise;
  }

  private resolvedEngineName(): string {
    const id = this.uciIdName;
    if (!id) return "Stockfish";
    return STOCKFISH_19_ID_RE.test(id) ? SERVER_ENGINE_NAME : id;
  }

  private scheduleIdleReap(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.queue.length > 0 || this.activeJob) return;
    this.idleTimer = setTimeout(() => {
      if (!this.activeJob && this.queue.length === 0) {
        this.destroyWorker(new ServerEngineError("engine_unavailable", 503));
      }
    }, IDLE_REAP_MS);
    this.idleTimer.unref?.();
  }

  private destroyWorker(err: ServerEngineError): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const rejectInit = this.rejectReadyInit;
    this.rejectReadyInit = null;
    rejectInit?.(err);
    const active = this.activeJob;
    this.activeJob = null;
    if (active) {
      clearTimeout(active.timer);
      if (active.killTimer) clearTimeout(active.killTimer);
      active.job.reject(err);
    }
    const proc = this.child;
    this.child = null;
    this.readyPromise = null;
    this.readyBin = null;
    this.uciIdName = null;
    if (proc) {
      try {
        proc.stdin.write("quit\n");
      } catch {
        // ignore
      }
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const queued = this.queue.splice(0);
    for (const q of queued) {
      q.reject(new ServerEngineError("engine_disabled", 503));
    }
    this.destroyWorker(new ServerEngineError("engine_disabled", 503));
    this.shuttingDown = false;
  }
}

export const defaultServerEngine = new ServerEngineRunner();

export function shutdownServerEngine(): Promise<void> {
  return defaultServerEngine.shutdown();
}
