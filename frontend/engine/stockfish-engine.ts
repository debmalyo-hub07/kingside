// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser Stockfish in a Web Worker, speaking UCI. Two nets: "lite" (~1.7 MB, about twice the
// speed: live analysis, bots, practice) and "full" (~99 MB, strongest: game review). One search at a time:
// a new analyze() call stops the running search and starts the new one after `bestmove`.

import { type Color, isUnrelatedGameFen } from "@kingside/chess-core";
import { type EngineInfo, parseInfoLine } from "@kingside/uci";

export const ENGINE_NAME = "Stockfish 19 NNUE";

export type EngineNet = "lite" | "full";

export function engineLabel(net: EngineNet): string {
  return net === "lite" ? "Stockfish 19 Lite" : ENGINE_NAME;
}

function engineBase(net: EngineNet, multiThreaded: boolean): string {
  return `/engine/stockfish-19${net === "lite" ? "-lite" : ""}${multiThreaded ? "" : "-single"}`;
}

const ENGINE_CACHE_NAME = "ks-engine-sf19";

interface PrefetchEntry {
  promise: Promise<void>;
  progress: number;
  listeners: Set<(fraction: number) => void>;
}

const prefetched = new Map<string, PrefetchEntry>();

export function resetPrefetchCache(): void {
  prefetched.clear();
}

/**
 * Downloads the engine's WASM ahead of the worker, reporting progress (0..1), so the first visit can
 * show how far the download is. Concurrent callers share one download and receive progress updates,
 * and the response is stored in CacheStorage when available so the worker never downloads twice.
 */
export function prefetchEngine(net: EngineNet, onProgress?: (fraction: number) => void): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const url = `${engineBase(net, window.crossOriginIsolated)}.wasm`;
  const existing = prefetched.get(url);
  if (existing) {
    if (onProgress) {
      onProgress(existing.progress);
      if (existing.progress < 1) existing.listeners.add(onProgress);
    }
    return existing.promise;
  }

  const entry: PrefetchEntry = {
    promise: Promise.resolve(),
    progress: 0,
    listeners: new Set(onProgress ? [onProgress] : []),
  };

  const notify = (fraction: number) => {
    entry.progress = fraction;
    for (const cb of entry.listeners) cb(fraction);
  };

  entry.promise = (async () => {
    try {
      const cache =
        typeof caches !== "undefined" ? await caches.open(ENGINE_CACHE_NAME).catch(() => null) : null;
      if (cache && (await cache.match(url))) {
        notify(1);
        return;
      }

      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        throw new Error(`Engine prefetch failed with HTTP ${res.status}`);
      }
      const cacheCopy = cache && (res.type === "basic" || res.type === "default") ? res.clone() : null;
      const total = Number(res.headers.get("content-length")) || 0;
      if (!res.body || !total) {
        await res.arrayBuffer();
      } else {
        const reader = res.body.getReader();
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.byteLength;
          notify(Math.min(0.99, loaded / total));
        }
      }
      if (cache && cacheCopy) {
        await cache.put(url, cacheCopy).catch(() => undefined);
      }
    } catch {
      prefetched.delete(url);
    } finally {
      notify(1);
      entry.listeners.clear();
    }
  })();

  prefetched.set(url, entry);
  return entry.promise;
}

export interface AnalyzeOptions {
  /** null = no depth limit: infinite, or time-only when movetimeMs is set. */
  depth: number | null;
  /** Optional time cap in ms; the search stops at whichever limit comes first. */
  movetimeMs?: number;
  /**
   * Optional node budget. Unlike time, a node budget gives the same result on fast and slow devices
   * (docs/ALGORITHMS.md §8b), so reviews use it instead of depth/time.
   */
  nodes?: number;
  multiPv: number;
}

export interface EngineSnapshot {
  fen: string;
  /** Lines sorted by multipv (best first), White-POV scores. */
  lines: EngineInfo[];
  depth: number;
  nps?: number;
  done: boolean;
  /** Non-empty when the worker failed to initialize or crashed. */
  error?: string;
}

type Listener = (snapshot: EngineSnapshot) => void;

interface Job {
  fen: string;
  options: AnalyzeOptions;
  listener: Listener;
  lines: Map<number, EngineInfo>;
}

const EMIT_INTERVAL_MS = 100;

/**
 * Detects if the current client is a mobile device (phone or tablet).
 * Uses userAgentData Client Hints, user-agent matching, iPadOS desktop-mode detection,
 * and touch-screen viewport heuristics.
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const isClientHintsMobile = Boolean(
    (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile,
  );
  const ua = navigator.userAgent || "";
  const isMobileUa = /Android|iPhone|iPad|iPod/i.test(ua);
  const isTouchScreen =
    ((typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0) ||
      "ontouchstart" in window) &&
    (typeof window.innerWidth === "number" ? window.innerWidth <= 768 : false);
  const isIPadOS =
    typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
  return isClientHintsMobile || isMobileUa || isTouchScreen || isIPadOS;
}

/** Clamps threads: max 2 on mobile devices, max 8 on desktop. Resolves 0 / non-finite to auto available threads. */
export function clampEngineThreads(threads: number): number {
  const maxThreads = isMobileDevice() ? 2 : 8;
  const target = Number.isFinite(threads) && threads > 0 ? Math.floor(threads) : engineThreadsAvailable();
  return Math.max(1, Math.min(target, maxThreads));
}

/** Clamps hash: max 32MB on mobile devices to prevent memory exhaustion, up to 1024MB on desktop. */
export function clampEngineHash(hashMb: number): number {
  const maxHash = isMobileDevice() ? 32 : 1024;
  const safeHash = Number.isFinite(hashMb) && hashMb > 0 ? Math.floor(hashMb) : isMobileDevice() ? 32 : 64;
  return Math.max(16, Math.min(safeHash, maxHash));
}

export function engineThreadsAvailable(): number {
  if (typeof window === "undefined" || !window.crossOriginIsolated) return 1;
  const maxThreads = isMobileDevice() ? 2 : 8;
  const cores =
    typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 2;
  return Math.max(1, Math.min(cores - 1, maxThreads));
}

export class StockfishEngine {
  readonly multiThreaded: boolean;
  readonly net: EngineNet;
  private readonly worker: Worker | null;
  private readonly ready: Promise<void>;
  private resolveReady: () => void = () => {};
  private rejectReady: (err: Error) => void = () => {};
  private current: Job | null = null;
  private pending: Job | null = null;
  private awaitingReadyJob: Job | null = null;
  private searching = false;
  private failed: Error | null = null;
  private destroyed = false;
  private lastFen: string | null = null;
  private needsNewGame = false;
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor({ threads, hashMb, net = "full" }: { threads: number; hashMb: number; net?: EngineNet }) {
    this.multiThreaded = typeof window !== "undefined" && window.crossOriginIsolated;
    this.net = net;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Avoid unhandled rejections if destroyed or failed while no search is awaiting ready.
    this.ready.catch(() => undefined);

    let worker: Worker;
    try {
      worker = new Worker(`${engineBase(net, this.multiThreaded)}.js`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to create Stockfish worker");
      this.worker = null;
      this.fail(error);
      return;
    }

    this.worker = worker;
    worker.onmessage = (e: MessageEvent<string>) => this.onLine(String(e.data));
    worker.onerror = (e: ErrorEvent) => {
      const msg = e?.message ? `Stockfish worker error: ${e.message}` : "Stockfish worker failed to load";
      console.error(msg);
      this.fail(new Error(msg));
    };
    worker.onmessageerror = () => {
      const msg = "Stockfish worker message error";
      console.error(msg);
      this.fail(new Error(msg));
    };

    this.send("uci");
    this.configure({ threads, hashMb });
  }

  /** Applies Threads/Hash. Only call while idle (between searches). */
  configure({ threads, hashMb }: { threads: number; hashMb: number }): void {
    if (this.failed || this.destroyed) return;
    const effectiveThreads = clampEngineThreads(threads);
    const effectiveHashMb = clampEngineHash(hashMb);
    if (this.multiThreaded) this.send(`setoption name Threads value ${effectiveThreads}`);
    this.send(`setoption name Hash value ${effectiveHashMb}`);
    this.send("isready");
  }

  analyze(fen: string, options: AnalyzeOptions, listener: Listener): void {
    if (this.destroyed) {
      listener({ fen, lines: [], depth: 0, done: true, error: "Stockfish worker destroyed" });
      return;
    }
    if (this.failed) {
      listener({ fen, lines: [], depth: 0, done: true, error: this.failed.message });
      return;
    }
    const job: Job = { fen, options, listener, lines: new Map() };
    if (this.searching) {
      // Replaced before it was sent: tell its listener it is over so evaluate() promises settle.
      this.pending?.listener({ fen: this.pending.fen, lines: [], depth: 0, done: true });
      this.pending = job;
      if (this.current) this.send("stop");
      return;
    }
    void this.start(job);
  }

  /** Sends a UCI option. Only call between searches (e.g. bot strength settings). */
  setOption(name: string, value: string | number | boolean): void {
    if (this.failed || this.destroyed) return;
    this.send(`setoption name ${name} value ${value}`);
  }

  /** Marks the next search as a new game so `ucinewgame` clears TT/history tables. */
  newGame(): void {
    if (this.failed || this.destroyed) return;
    this.needsNewGame = true;
  }

  /** Searches `fen` to completion and resolves with the final snapshot (or rejects on worker failure). */
  evaluate(fen: string, options: AnalyzeOptions, signal?: AbortSignal): Promise<EngineSnapshot> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        this.stop();
        resolve({ fen, lines: [], depth: 0, done: true });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.analyze(fen, options, (s) => {
        if (!s.done || settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        if (s.error) reject(new Error(s.error));
        else resolve(s);
      });
    });
  }

  /** Stops the current search; its listener receives a final `done` snapshot. */
  stop(): void {
    this.pending = null;
    if (this.awaitingReadyJob) {
      const job = this.awaitingReadyJob;
      this.awaitingReadyJob = null;
      this.searching = false;
      job.listener({ fen: job.fen, lines: [], depth: 0, done: true });
      return;
    }
    if (this.searching && !this.failed && !this.destroyed) this.send("stop");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.searching = false;
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    const awaiting = this.awaitingReadyJob;
    const cur = this.current;
    const pend = this.pending;
    this.awaitingReadyJob = null;
    this.current = null;
    this.pending = null;
    this.rejectReady(new Error("Stockfish worker destroyed"));
    awaiting?.listener({ fen: awaiting.fen, lines: [], depth: 0, done: true });
    cur?.listener({ fen: cur.fen, lines: [], depth: 0, done: true });
    pend?.listener({ fen: pend.fen, lines: [], depth: 0, done: true });
    this.worker?.terminate();
  }

  private fail(error: Error): void {
    if (this.failed) return;
    this.failed = error;
    this.searching = false;
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    const awaiting = this.awaitingReadyJob;
    const cur = this.current;
    const pend = this.pending;
    this.awaitingReadyJob = null;
    this.current = null;
    this.pending = null;
    this.rejectReady(error);
    if (awaiting)
      awaiting.listener({ fen: awaiting.fen, lines: [], depth: 0, done: true, error: error.message });
    if (cur) cur.listener({ fen: cur.fen, lines: [], depth: 0, done: true, error: error.message });
    if (pend) pend.listener({ fen: pend.fen, lines: [], depth: 0, done: true, error: error.message });
  }

  private async start(first: Job): Promise<void> {
    // Mark busy *before* waiting for the engine: otherwise two quick analyze() calls during start-up
    // both start, the engine gets a second `position` mid-search, and the first position's lines are
    // reported for the second one (old lines + arrows on the new position).
    this.searching = true;
    this.awaitingReadyJob = first;
    try {
      await this.ready;
    } catch (err) {
      const stillAwaiting = this.awaitingReadyJob === first;
      if (stillAwaiting) {
        this.awaitingReadyJob = null;
        this.searching = false;
      }
      if (!stillAwaiting || this.destroyed) return;
      const msg = err instanceof Error ? err.message : "Stockfish worker failed";
      first.listener({ fen: first.fen, lines: [], depth: 0, done: true, error: msg });
      if (this.pending) {
        const pend = this.pending;
        this.pending = null;
        pend.listener({ fen: pend.fen, lines: [], depth: 0, done: true, error: msg });
      }
      return;
    }
    if (this.awaitingReadyJob !== first) {
      return;
    }
    this.awaitingReadyJob = null;
    if (this.destroyed || this.failed) {
      this.searching = false;
      if (this.destroyed) {
        first.listener({ fen: first.fen, lines: [], depth: 0, done: true });
      } else {
        first.listener({
          fen: first.fen,
          lines: [],
          depth: 0,
          done: true,
          error: this.failed?.message ?? "Stockfish worker failed",
        });
      }
      return;
    }
    // A newer request that arrived while we waited replaces this one before anything is sent.
    let job = first;
    if (this.pending) {
      first.listener({ fen: first.fen, lines: [], depth: 0, done: true });
      job = this.pending;
      this.pending = null;
    }
    this.current = job;
    if (this.needsNewGame || (this.lastFen !== null && isUnrelatedGameFen(this.lastFen, job.fen))) {
      this.send("ucinewgame");
    }
    this.needsNewGame = false;
    this.lastFen = job.fen;
    this.send(`setoption name MultiPV value ${job.options.multiPv}`);
    this.send(`position fen ${job.fen}`);
    const { depth, movetimeMs, nodes } = job.options;
    if (nodes) this.send(`go nodes ${nodes}`);
    else if (depth === null && movetimeMs) this.send(`go movetime ${movetimeMs}`);
    else if (depth === null) this.send("go infinite");
    else this.send(`go depth ${depth}${movetimeMs ? ` movetime ${movetimeMs}` : ""}`);
  }

  private onLine(line: string): void {
    if (this.destroyed || this.failed) return;
    if (line === "readyok") {
      this.resolveReady();
      return;
    }
    const job = this.current;
    if (line.startsWith("info") && job && !this.pending) {
      const info = parseInfoLine(line, sideToMove(job.fen));
      if (info) {
        job.lines.set(info.multipv, info);
        this.scheduleEmit(job, false);
      }
      return;
    }
    if (line.startsWith("bestmove")) {
      this.searching = false;
      // A replaced search still reports `done` (evaluate() promises must settle); listeners check
      // that the snapshot's position is still the one they want.
      if (job) this.emit(job, true);
      this.current = null;
      const next = this.pending;
      this.pending = null;
      if (next) void this.start(next);
    }
  }

  private scheduleEmit(job: Job, done: boolean): void {
    const wait = EMIT_INTERVAL_MS - (performance.now() - this.lastEmit);
    if (wait <= 0) {
      this.emit(job, done);
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        if (this.current === job) this.emit(job, false);
      }, wait);
    }
  }

  private emit(job: Job, done: boolean): void {
    this.lastEmit = performance.now();
    const lines = [...job.lines.values()].sort((a, b) => a.multipv - b.multipv);
    job.listener({
      fen: job.fen,
      lines,
      depth: lines[0]?.depth ?? 0,
      ...(lines[0]?.nps !== undefined ? { nps: lines[0].nps } : {}),
      done,
    });
  }

  private send(command: string): void {
    this.worker?.postMessage(command);
  }
}

function sideToMove(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}
