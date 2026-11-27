// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the browser engine over every position of a game, then scores it with chess-core.
// Phase 2 pipeline:
// 1. Opening positions check ephemeral Lichess cloud-eval (depth >= 30, >= 1 PV, local cache only — never MongoDB).
// 2. Remaining positions check Dexie + shared MongoDB EvalCache (Kingside Stockfish evals only).
// 3. Pass 1 computes misses with MultiPV = 1 (or falls back to /api/engine/eval if WASM fails).
// 4. Pass 2 re-searches criticalPositions at MultiPV = 3 (4x nodes) + depth-2 shallow surprise probe for sacrifices.

import {
  criticalPositions,
  type EngineLine,
  positionFromFen,
  type ReviewInput,
  type ReviewPosition,
  reviewGame,
} from "@kingside/chess-core";
import {
  clampEngineHash,
  clampEngineThreads,
  ENGINE_NAME,
  engineThreadsAvailable,
  prefetchEngine,
  StockfishEngine,
} from "@/engine/stockfish-engine";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { evalKey, getCachedEval, putCachedEval } from "@/lib/local-db";
import { countBookPlies, loadOpenings, openingOf } from "@/lib/openings";
import { useSettings } from "@/lib/settings-store";
import { useReview } from "./review-store";

const PASS1_MULTI_PV = 1;
const PASS2_MULTI_PV = 3;
const SHALLOW_PROBE_DEPTH = 2;
/** Cloud evaluations are only asked for the opening (that is where they exist), like Lichess does. */
const CLOUD_MAX_PLIES = 20;
const CLOUD_MIN_DEPTH = 30;
const CLOUD_REQUEST_MULTI_PV = 2;
/** Cache entries of node-budget searches are stored under their own engine tag, budget in kilonodes. */
const CACHE_ENGINE = `${ENGINE_NAME}|nodes`;
/** Separate local-only cache namespace for Lichess cloud evaluations (never written to MongoDB EvalCache). */
const CLOUD_CACHE_ENGINE = "lichess-cloud";
/** Local-only Dexie cache namespace for depth-2 shallow surprise probes. */
const SHALLOW_CACHE_ENGINE = `${ENGINE_NAME}|d2`;
const EVAL_CACHE_WRITE_BATCH = 80;
const EVAL_CACHE_LOOKUP_BATCH = 120;
const SERVER_BUSY_BACKOFF_MS = [350, 800] as const;

interface CloudEval {
  depth: number;
  pvs: { moves: string[]; cp?: number; mate?: number }[];
}

interface SharedEvalLine {
  pv: string[];
  cp?: number;
  mate?: number;
  depth: number;
}

interface SharedEvalEntry {
  depth: number;
  multipv: number;
  lines: SharedEvalLine[];
}

interface ServerEngineStatus {
  enabled: boolean;
  available: boolean;
  maxNodes: number;
  maxMultiPv: number;
}

interface ServerEvalResponse {
  lines: EngineLine[];
  engine?: string;
  nodes?: number;
  multipv?: number;
}

interface EvalRawResult {
  lines: EngineLine[];
  engineUsed: string;
  nodesUsed?: number;
  multiPvUsed: number;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ReviewBudget {
  /** Nodes per position in the first pass. */
  nodes: number;
  /** Nodes per critical position in the second pass. */
  recheckNodes: number;
}

type CloudFetchResult = { kind: "hit"; lines: EngineLine[] } | { kind: "miss" } | { kind: "unavailable" };

function isAbortError(e: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (e instanceof DOMException && e.name === "AbortError");
}

function epdOf(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

function fromSharedLines(lines: readonly SharedEvalLine[]): EngineLine[] {
  return lines.map((l) => ({
    pv: l.pv,
    score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 },
    depth: l.depth,
  }));
}

function toSharedLines(lines: readonly EngineLine[]): SharedEvalLine[] {
  return lines
    .filter((l) => l.pv.length > 0 && l.depth >= 1)
    .map((l) => ({
      pv: l.pv.slice(0, 24),
      depth: Math.max(1, Math.min(127, l.depth)),
      ...(l.score.mate !== undefined ? { mate: l.score.mate } : { cp: l.score.cp }),
    }));
}

async function cloudLines(fen: string, signal: AbortSignal): Promise<CloudFetchResult> {
  try {
    const c = await apiGet<CloudEval>(
      `/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${CLOUD_REQUEST_MULTI_PV}`,
      signal,
    );
    // Accept valid depth 30+ cloud evaluations even when only 1 PV is stored.
    if (c.depth < CLOUD_MIN_DEPTH || c.pvs.length < 1) return { kind: "miss" };
    return {
      kind: "hit",
      lines: c.pvs.map((p) => ({
        pv: p.moves,
        score: p.mate !== undefined ? { mate: p.mate } : { cp: p.cp ?? 0 },
        depth: c.depth,
      })),
    };
  } catch (e) {
    if (isAbortError(e, signal)) throw e;
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { kind: "miss" };
    return { kind: "unavailable" };
  }
}

async function sharedCacheLookup(
  fens: readonly string[],
  indices: readonly number[],
  minKilo: number,
  multiPv: number,
  signal: AbortSignal,
): Promise<Map<number, { depth: number; multipv: number; lines: EngineLine[] }>> {
  const hits = new Map<number, { depth: number; multipv: number; lines: EngineLine[] }>();
  if (indices.length === 0) return hits;

  for (let offset = 0; offset < indices.length; offset += EVAL_CACHE_LOOKUP_BATCH) {
    if (signal.aborted) break;
    const chunk = indices.slice(offset, offset + EVAL_CACHE_LOOKUP_BATCH);
    try {
      const res = await apiPost<{ items: Record<string, SharedEvalEntry> }>(
        "/api/eval-cache/lookup",
        {
          items: chunk.map((idx) => ({
            fen: fens[idx] as string,
            engine: CACHE_ENGINE,
            depth: minKilo,
            multiPv,
          })),
        },
        signal,
      );
      if (!res?.items) continue;
      for (const idx of chunk) {
        const key = `${epdOf(fens[idx] as string)}|${CACHE_ENGINE}`;
        const hit = res.items[key];
        if (hit && hit.lines.length > 0) {
          hits.set(idx, {
            depth: hit.depth,
            multipv: hit.multipv,
            lines: fromSharedLines(hit.lines),
          });
        }
      }
    } catch (e) {
      if (isAbortError(e, signal)) throw e;
      break;
    }
  }
  return hits;
}

function flushSharedCache(
  entries: { fen: string; depth: number; multipv: number; lines: EngineLine[] }[],
): void {
  if (entries.length === 0) return;
  const payload = entries
    .map((e) => {
      const lines = toSharedLines(e.lines);
      if (lines.length === 0) return null;
      return {
        fen: e.fen,
        engine: CACHE_ENGINE,
        depth: e.depth,
        multipv: e.multipv,
        lines,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  for (let i = 0; i < payload.length; i += EVAL_CACHE_WRITE_BATCH) {
    const chunk = payload.slice(i, i + EVAL_CACHE_WRITE_BATCH);
    void apiPost("/api/eval-cache", { entries: chunk }).catch(() => undefined);
  }
}

export async function runReview({ nodes, recheckNodes }: ReviewBudget, signal: AbortSignal): Promise<void> {
  const { fens, moves, meta } = useReview.getState();
  const { engineThreads, engineHashMb } = useSettings.getState();
  const available = engineThreadsAvailable();
  const threads = clampEngineThreads(engineThreads > 0 ? Math.min(engineThreads, available) : available);
  const hashMb = clampEngineHash(engineHashMb);
  const openings = loadOpenings().catch(() => null);

  // Created only if some position is not cached yet (saves the ~99 MB engine load on re-reviews).
  const engine: { current: StockfishEngine | null } = { current: null };
  let useServerFallback = false;
  let serverChecked = false;
  let serverMaxNodes = 400_000;
  let serverMaxMultiPv = 2;

  const onAbort = () => engine.current?.destroy();
  signal.addEventListener("abort", onAbort, { once: true });

  const sharedWriteQueue: { fen: string; depth: number; multipv: number; lines: EngineLine[] }[] = [];

  const canUseServerFallback = async (): Promise<boolean> => {
    if (useServerFallback) return true;
    if (serverChecked) return false;
    serverChecked = true;
    try {
      const status = await apiGet<ServerEngineStatus>("/api/engine/status", signal);
      if (status?.enabled && status.available) {
        useServerFallback = true;
        serverMaxNodes = Math.max(10_000, status.maxNodes || 400_000);
        serverMaxMultiPv = Math.max(1, Math.min(2, status.maxMultiPv || 2));
        engine.current?.destroy();
        engine.current = null;
        return true;
      }
    } catch (e) {
      if (isAbortError(e, signal)) throw e;
    }
    return false;
  };

  const evaluateRaw = async (
    fen: string,
    opts: { nodes?: number; depth?: number; multiPv: number },
  ): Promise<EvalRawResult> => {
    const runOnServer = async (): Promise<EvalRawResult> => {
      const targetMultiPv = Math.min(opts.multiPv, serverMaxMultiPv);
      const targetNodes =
        opts.depth !== undefined ? undefined : Math.min(opts.nodes ?? nodes, serverMaxNodes);
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await apiPost<ServerEvalResponse>(
            "/api/engine/eval",
            {
              fen,
              multiPv: targetMultiPv,
              ...(opts.depth !== undefined ? { depth: opts.depth } : { nodes: targetNodes }),
            },
            signal,
          );
          return {
            lines: res.lines,
            engineUsed: res.engine ?? ENGINE_NAME,
            multiPvUsed: res.multipv ?? targetMultiPv,
            ...(targetNodes !== undefined ? { nodesUsed: res.nodes ?? targetNodes } : {}),
          };
        } catch (err) {
          if (isAbortError(err, signal)) throw err;
          const delay = SERVER_BUSY_BACKOFF_MS[attempt];
          if (
            delay !== undefined &&
            err instanceof ApiError &&
            err.status === 503 &&
            err.code === "engine_busy"
          ) {
            await abortableSleep(delay, signal);
            continue;
          }
          throw err;
        }
      }
    };

    if (useServerFallback) {
      return runOnServer();
    }

    const wasmUnavailableInBrowser =
      typeof window !== "undefined" && (typeof Worker === "undefined" || typeof WebAssembly === "undefined");
    if (wasmUnavailableInBrowser) {
      if (await canUseServerFallback()) return runOnServer();
      throw new Error("WebAssembly engine unavailable");
    }

    try {
      if (!engine.current) {
        useReview.getState().setDownload(0);
        await prefetchEngine("full", (f) => {
          if (!signal.aborted) useReview.getState().setDownload(f < 1 ? f : null);
        });
        if (!signal.aborted) useReview.getState().setDownload(null);
        if (signal.aborted) return { lines: [], engineUsed: ENGINE_NAME, multiPvUsed: opts.multiPv };
        engine.current = new StockfishEngine({ threads, hashMb });
      }
      const snap = await engine.current.evaluate(
        fen,
        opts.depth !== undefined
          ? { depth: opts.depth, multiPv: opts.multiPv }
          : { depth: null, nodes: opts.nodes ?? nodes, multiPv: opts.multiPv },
        signal,
      );
      return {
        lines: snap.lines.map((l) => ({ pv: l.pv, score: l.score, depth: l.depth })),
        engineUsed: ENGINE_NAME,
        multiPvUsed: opts.multiPv,
        ...(opts.depth === undefined ? { nodesUsed: opts.nodes ?? nodes } : {}),
      };
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      if (await canUseServerFallback()) {
        if (!signal.aborted) useReview.getState().setDownload(null);
        return runOnServer();
      }
      throw err;
    }
  };

  const computeAndCache = async (fen: string, budget: number, multiPv: number): Promise<EngineLine[]> => {
    const key = evalKey(fen, CACHE_ENGINE);
    const res = await evaluateRaw(fen, { nodes: budget, multiPv });
    if (!signal.aborted && res.lines.length > 0 && res.engineUsed === ENGINE_NAME) {
      const actualKilo = Math.max(1, Math.round((res.nodesUsed ?? budget) / 1000));
      const actualMultiPv = res.multiPvUsed;
      void putCachedEval(key, actualKilo, actualMultiPv, res.lines);
      sharedWriteQueue.push({ fen, depth: actualKilo, multipv: actualMultiPv, lines: res.lines });
    }
    return res.lines;
  };

  try {
    const lines: EngineLine[][] = fens.map(() => []);
    const pass1Lines: (EngineLine[] | undefined)[] = fens.map(() => undefined);
    const shallowLines: (EngineLine[] | undefined)[] = fens.map(() => undefined);
    const fromCloud = new Set<number>();
    const fromLocalOrShared = new Set<number>();
    const ended = fens.map((fen) => positionFromFen(fen).isEnd());
    const total = fens.length;
    let done = 0;
    const snapshotPositions = (): ReviewPosition[] =>
      fens.map((fen, idx) => ({ fen, lines: lines[idx] ?? [] }));
    const tick = (idx: number) =>
      useReview.getState().setProgress(Math.min(++done, total), snapshotPositions(), idx);

    // 1. Opening positions from local cloud cache or /api/cloud-eval (continue across uncached plies).
    let cloudUnavailable = false;
    for (let i = 0; i < Math.min(fens.length, CLOUD_MAX_PLIES); i++) {
      if (signal.aborted) return;
      if (ended[i]) continue;
      const fen = fens[i] as string;
      const cloudKey = evalKey(fen, CLOUD_CACHE_ENGINE);
      const cachedCloud = await getCachedEval(cloudKey, CLOUD_MIN_DEPTH, PASS1_MULTI_PV);
      if (cachedCloud) {
        lines[i] = cachedCloud;
        fromCloud.add(i);
        tick(i);
        continue;
      }
      if (cloudUnavailable) continue;
      const cloudRes = await cloudLines(fen, signal);
      if (cloudRes.kind === "unavailable") {
        cloudUnavailable = true;
        continue;
      }
      if (cloudRes.kind === "miss") continue;
      lines[i] = cloudRes.lines;
      fromCloud.add(i);
      const depth = cloudRes.lines[0]?.depth ?? CLOUD_MIN_DEPTH;
      // Lichess cloud-eval stays strictly in browser Dexie / RAM — never pushed to MongoDB EvalCache.
      void putCachedEval(cloudKey, depth, cloudRes.lines.length, cloudRes.lines);
      tick(i);
    }

    // 2. Check local Dexie first for remaining positions.
    const pass1Kilo = Math.round(nodes / 1000);
    const dexieMisses: number[] = [];
    for (let i = 0; i < fens.length; i++) {
      if (signal.aborted) return;
      if (fromCloud.has(i) || ended[i]) continue;
      const cached = await getCachedEval(evalKey(fens[i] as string, CACHE_ENGINE), pass1Kilo, PASS1_MULTI_PV);
      if (cached) {
        lines[i] = cached;
        fromLocalOrShared.add(i);
        tick(i);
      } else {
        dexieMisses.push(i);
      }
    }

    // 2b. Batch lookup shared MongoDB EvalCache for Dexie misses.
    if (dexieMisses.length > 0) {
      const sharedHits = await sharedCacheLookup(fens, dexieMisses, pass1Kilo, PASS1_MULTI_PV, signal);
      for (const [idx, hit] of sharedHits) {
        lines[idx] = hit.lines;
        fromLocalOrShared.add(idx);
        void putCachedEval(evalKey(fens[idx] as string, CACHE_ENGINE), hit.depth, hit.multipv, hit.lines);
        tick(idx);
      }
    }

    // 3. Pass 1 engine search (MultiPV = 1), last position first so TT stays warm.
    for (let i = fens.length - 1; i >= 0; i--) {
      if (signal.aborted) return;
      if (fromCloud.has(i) || fromLocalOrShared.has(i)) continue;
      if (!ended[i]) lines[i] = await computeAndCache(fens[i] as string, nodes, PASS1_MULTI_PV);
      tick(i);
    }

    const data = await openings;
    const bookPlies = data ? countBookPlies(data, fens.slice(1)) : 0;
    const opening = data ? (openingOf(data, fens.slice(0, bookPlies + 1)) ?? openingOf(data, fens)) : null;
    const input = (): ReviewInput => ({
      positions: fens.map(
        (fen, i): ReviewPosition => ({
          fen,
          lines: lines[i] ?? [],
          ...(pass1Lines[i] ? { pass1Lines: pass1Lines[i] } : {}),
          ...(shallowLines[i] ? { shallowLines: shallowLines[i] } : {}),
        }),
      ),
      moves,
      bookPlies,
      ratings: { white: meta?.white.rating ?? null, black: meta?.black.rating ?? null },
      timeClass: meta?.timeClass ?? null,
    });

    // 4. Pass 2: MultiPV = 3 at 4x nodes over criticalPositions (+ re-checking 1-PV cloud hits if critical).
    const draft = reviewGame(input());
    const critical = criticalPositions(draft, fens.length).filter(
      (i) => !ended[i] && !(fromCloud.has(i) && (lines[i]?.length ?? 0) >= 2),
    );
    const recheckKilo = Math.round(recheckNodes / 1000);
    useReview.getState().setRecheck(critical.length);

    const isSameTopLine = (a: readonly EngineLine[] | undefined, b: readonly EngineLine[] | undefined) =>
      Boolean(
        a?.[0] &&
          b?.[0] &&
          a[0].depth === b[0].depth &&
          a[0].pv[0] === b[0].pv[0] &&
          a[0].score.cp === b[0].score.cp &&
          a[0].score.mate === b[0].score.mate,
      );

    const pass2Misses: number[] = [];
    for (const i of critical) {
      if (signal.aborted) return;
      const fen = fens[i] as string;
      const cached = await getCachedEval(evalKey(fen, CACHE_ENGINE), recheckKilo, PASS2_MULTI_PV);
      if (cached) {
        if (!isSameTopLine(lines[i], cached)) pass1Lines[i] = lines[i];
        lines[i] = cached;
        useReview.getState().setProgress(total, snapshotPositions(), i);
        useReview.getState().tickRecheck();
      } else {
        pass2Misses.push(i);
      }
    }

    if (pass2Misses.length > 0) {
      const sharedPass2 = await sharedCacheLookup(fens, pass2Misses, recheckKilo, PASS2_MULTI_PV, signal);
      for (const i of pass2Misses) {
        if (signal.aborted) return;
        const hit = sharedPass2.get(i);
        if (hit) {
          if (!isSameTopLine(lines[i], hit.lines)) pass1Lines[i] = lines[i];
          lines[i] = hit.lines;
          void putCachedEval(evalKey(fens[i] as string, CACHE_ENGINE), hit.depth, hit.multipv, hit.lines);
          useReview.getState().setProgress(total, snapshotPositions(), i);
          useReview.getState().tickRecheck();
          continue;
        }
        pass1Lines[i] = lines[i];
        lines[i] = await computeAndCache(fens[i] as string, recheckNodes, PASS2_MULTI_PV);
        useReview.getState().setProgress(total, snapshotPositions(), i);
        useReview.getState().tickRecheck();
      }
    }

    // 5. Quick depth-2 surprise probe (arXiv:2406.11895) on sacrifice candidates (Dexie-cached).
    const sacPositions = new Set<number>();
    for (const m of draft.moves) {
      if (m.sacrifice) {
        if (!ended[m.ply - 1]) sacPositions.add(m.ply - 1);
        if (!ended[m.ply]) sacPositions.add(m.ply);
      }
    }
    for (const i of sacPositions) {
      if (signal.aborted) return;
      const fen = fens[i] as string;
      const shallowKey = evalKey(fen, SHALLOW_CACHE_ENGINE);
      const cachedShallow = await getCachedEval(shallowKey, SHALLOW_PROBE_DEPTH, 1);
      if (cachedShallow) {
        shallowLines[i] = cachedShallow;
        continue;
      }
      if (!engine.current && !useServerFallback) continue;
      try {
        const res = await evaluateRaw(fen, {
          depth: SHALLOW_PROBE_DEPTH,
          multiPv: 1,
        });
        if (!signal.aborted && res.lines.length > 0) {
          shallowLines[i] = res.lines;
          if (res.engineUsed === ENGINE_NAME) {
            void putCachedEval(shallowKey, SHALLOW_PROBE_DEPTH, 1, res.lines);
          }
        }
      } catch (err) {
        if (isAbortError(err, signal)) throw err;
      }
    }

    if (!signal.aborted && sharedWriteQueue.length > 0) {
      flushSharedCache(sharedWriteQueue);
    }

    const final = input();
    const review = reviewGame(final);
    if (!signal.aborted) {
      useReview.getState().setProgress(total, final.positions);
      useReview.getState().finish(review, opening);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!signal.aborted) useReview.getState().setDownload(null);
    engine.current?.destroy();
  }
}
