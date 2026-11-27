// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen } from "@kingside/chess-core";
import type { EngineInfo } from "@kingside/uci";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { type CachedEval, evalKey, getDb, putCachedEval, withTimeout } from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { whenIdle } from "@/lib/when-idle";
import {
  clampEngineHash,
  clampEngineThreads,
  ENGINE_NAME,
  type EngineNet,
  type EngineSnapshot,
  engineLabel,
  engineThreadsAvailable,
  prefetchEngine,
  StockfishEngine,
} from "./stockfish-engine";

export type EvalSource = "local" | "cache";

export interface EngineState {
  snapshot: EngineSnapshot | null;
  source: EvalSource | null;
  multiThreaded: boolean;
  threads: number;
  net: EngineNet;
  /** Engine download progress 0..1 on first load; null once the engine is ready to start. */
  loading: number | null;
  /** Error message when the worker fails to initialize or crashes. */
  error: string | null;
}

interface SharedCacheEntry {
  depth: number;
  multipv: number;
  lines: { pv: string[]; cp?: number; mate?: number; depth: number }[];
}

export const NODE_BUDGET_CACHE_ENGINE = `${ENGINE_NAME}|nodes`;

/**
 * Node-budget review caches (`...|nodes`) store kilonodes in `CachedEval.depth`, while actual
 * search depth in plies is stored per-line in `lines[i].depth`. Always normalize to minimum
 * positive search plies so `isExternalEvalSatisfied` never mistakes kilonodes (e.g. 400) or
 * a mixed-depth PV entry for a full multi-line search.
 */
export function resolveCachedSearchDepth(hit: Pick<CachedEval, "key" | "depth" | "lines">): number {
  if (hit.lines.length === 0) return 0;
  const minPositive = hit.lines.reduce(
    (min, l) => (l.depth > 0 ? Math.min(min, l.depth) : min),
    Number.POSITIVE_INFINITY,
  );
  if (hit.key.endsWith("|nodes")) {
    return Number.isFinite(minPositive) ? minPositive : 0;
  }
  return Number.isFinite(minPositive) ? Math.min(hit.depth, minPositive) : hit.depth;
}

export function isBetterExternalEval(
  current: { fen: string; depth: number; lines: number },
  next: { fen: string; depth: number; linesCount: number },
): boolean {
  return (
    current.fen !== next.fen ||
    next.linesCount > current.lines ||
    (next.linesCount === current.lines && next.depth > current.depth)
  );
}

export function isExternalEvalSatisfied(
  depth: number,
  linesCount: number,
  targetDepth: number | null,
  targetLines: number,
): boolean {
  return targetDepth !== null && depth >= targetDepth && linesCount >= targetLines;
}

export function shouldSkipLocalUpdate(
  ext: { fen: string; depth: number; lines: number },
  fen: string,
  localDepth: number,
  localDone: boolean,
  targetDepth: number | null,
  targetLines: number,
): boolean {
  return (
    ext.fen === fen &&
    ext.lines >= targetLines &&
    ext.depth > localDepth &&
    !(targetDepth === null && localDone)
  );
}

export function countLegalMovesCapped(fen: string, cap: number): number {
  try {
    const pos = positionFromFen(fen);
    let count = 0;
    for (const [sq, dests] of pos.allDests()) {
      const piece = pos.board.get(sq);
      if (piece?.role === "pawn") {
        for (const d of dests) {
          const rank = Math.floor(d / 8);
          count += rank === 0 || rank === 7 ? 4 : 1;
          if (count >= cap) return cap;
        }
      } else {
        count += dests.size();
      }
      if (count >= cap) return cap;
    }
    return count;
  } catch {
    return cap;
  }
}

export function shouldPreserveVisibleLines(
  prev: Pick<EngineSnapshot, "fen" | "lines" | "done"> | null,
  next: Pick<EngineSnapshot, "fen" | "lines" | "done">,
): boolean {
  return Boolean(prev && prev.fen === next.fen && !next.done && next.lines.length < prev.lines.length);
}

export function shouldSkipExternalSnapshot(
  local: { fen: string; depth: number; lines: number; done: boolean },
  fen: string,
  extDepth: number,
  extLinesCount: number,
): boolean {
  if (local.fen !== fen || local.lines === 0) return false;
  if (local.done) return true;
  if (local.lines > extLinesCount) return true;
  return local.lines === extLinesCount && local.depth >= extDepth;
}

/**
 * Analyzes `fen` with pure local Stockfish 19 WASM while `enabled`. Pass fen = null for positions
 * that need no analysis (game over). Checks local Stockfish Dexie cache and Kingside's shared
 * Stockfish EvalCache in parallel so known positions resolve instantly, and refines or computes
 * wider MultiPV lines with local Stockfish 19.
 */
export function useEngineAnalysis(fen: string | null, enabled: boolean, gameKey?: unknown): EngineState {
  const { engineDepth, engineLines, engineThreads, engineHashMb, analysisNet: net } = useSettings();
  const targetLines = useMemo(
    () => (fen ? Math.max(1, countLegalMovesCapped(fen, engineLines)) : engineLines),
    [fen, engineLines],
  );
  const [loading, setLoading] = useState<number | null>(0);
  const [loadedNet, setLoadedNet] = useState<EngineNet | null>(null);
  const engine = useRef<{ instance: StockfishEngine; key: string } | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [source, setSource] = useState<EvalSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [externalSatisfiedFen, setExternalSatisfiedFen] = useState<string | null>(null);
  const wanted = useRef<string | null>(null);
  const prevFenRef = useRef<string | null>(null);
  const prevGameKeyRef = useRef<unknown>(gameKey);
  const externalDepthRef = useRef<{ fen: string; depth: number; lines: number }>({
    fen: "",
    depth: 0,
    lines: 0,
  });
  const localProgressRef = useRef<{ fen: string; depth: number; lines: number; done: boolean }>({
    fen: "",
    depth: 0,
    lines: 0,
    done: false,
  });
  const [multiThreaded, setMultiThreaded] = useState(false);
  // Known only in the browser; null until mounted so server and client render the same.
  const [available, setAvailable] = useState<number | null>(null);
  const threads = clampEngineThreads(
    engineThreads > 0 ? Math.min(engineThreads, available ?? 1) : (available ?? 1),
  );
  const hashMb = clampEngineHash(engineHashMb);

  useEffect(() => {
    const cancel = whenIdle(() => setAvailable(engineThreadsAvailable()));
    return () => {
      cancel();
      engine.current?.instance.destroy();
      engine.current = null;
    };
  }, []);

  // Download the net (with progress) before the worker starts; switching nets downloads the other one.
  useEffect(() => {
    if (available === null) return;
    let live = true;
    setLoading(0);
    void prefetchEngine(net, (f) => live && setLoading(f < 1 ? f : null)).then(() => {
      if (live) {
        setLoading(null);
        setLoadedNet(net);
      }
    });
    return () => {
      live = false;
    };
  }, [available, net]);

  // Immediate local Stockfish Dexie + shared Kingside EvalCache lookup (no external Lichess Cloud Eval).
  useEffect(() => {
    if (!enabled || !fen) {
      prevFenRef.current = null;
      wanted.current = null;
      setSnapshot(null);
      setSource(null);
      setError(null);
      setExternalSatisfiedFen(null);
      externalDepthRef.current = { fen: "", depth: 0, lines: 0 };
      localProgressRef.current = { fen: "", depth: 0, lines: 0, done: false };
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const fenChanged = prevFenRef.current !== fen;
    prevFenRef.current = fen;
    wanted.current = fen;
    if (fenChanged) {
      setSnapshot(null);
      setSource(null);
    } else {
      // Preserve currently visible lines while restarting cleanly for updated depth/MultiPV/net.
      setSnapshot((prev) =>
        prev && prev.fen === fen ? { ...prev, lines: prev.lines.slice(0, engineLines), done: false } : null,
      );
    }
    setError(null);
    setExternalSatisfiedFen(null);
    externalDepthRef.current = { fen, depth: 0, lines: 0 };
    localProgressRef.current = { fen, depth: 0, lines: 0, done: false };

    const applyExternal = (lines: EngineInfo[], depth: number, src: EvalSource) => {
      if (cancelled || wanted.current !== fen || lines.length === 0) return false;
      const sliced = lines.slice(0, engineLines);
      if (shouldSkipExternalSnapshot(localProgressRef.current, fen, depth, sliced.length)) {
        return false;
      }
      if (!isBetterExternalEval(externalDepthRef.current, { fen, depth, linesCount: sliced.length })) {
        return false;
      }
      const isSatisfied = isExternalEvalSatisfied(depth, sliced.length, engineDepth, targetLines);
      externalDepthRef.current = { fen, depth, lines: sliced.length };
      setSnapshot({
        fen,
        lines: sliced,
        depth,
        done: isSatisfied,
      });
      setSource(src);
      if (isSatisfied) {
        setExternalSatisfiedFen(fen);
        engine.current?.instance.stop();
      }
      return isSatisfied;
    };

    void (async () => {
      let satisfied = false;
      // 1. Local Dexie lookup across local Stockfish engine caches only.
      try {
        const db = getDb();
        if (db) {
          const candidates: { key: string; src: EvalSource }[] = [
            { key: evalKey(fen, engineLabel(net)), src: "cache" },
            ...(net === "full"
              ? [
                  { key: evalKey(fen, ENGINE_NAME), src: "cache" as const },
                  { key: evalKey(fen, NODE_BUDGET_CACHE_ENGINE), src: "cache" as const },
                ]
              : []),
          ];
          const hits = await withTimeout(
            Promise.all(candidates.map((c) => db.evals.get(c.key).then((hit) => ({ hit, src: c.src })))),
            1200,
            [],
          );
          if (cancelled || wanted.current !== fen) return;
          for (const { hit, src } of hits) {
            if (!hit || hit.lines.length === 0) continue;
            const searchDepth = resolveCachedSearchDepth(hit);
            if (searchDepth <= 0) continue;
            const actualLines = Math.min(hit.multipv, hit.lines.length);
            if (actualLines < targetLines && externalDepthRef.current.lines >= actualLines) continue;
            const mapped: EngineInfo[] = hit.lines
              .slice(0, Math.min(engineLines, actualLines))
              .map((l, idx) => ({
                depth: l.depth,
                multipv: idx + 1,
                score: l.score,
                pv: l.pv,
              }));
            if (applyExternal(mapped, searchDepth, src)) satisfied = true;
          }
        }
      } catch {
        // Best-effort local cache read.
      }

      if (cancelled || satisfied || wanted.current !== fen || net !== "full") return;

      // 2. Non-blocking shared Kingside Stockfish 19 EvalCache lookup.
      await apiGet<SharedCacheEntry>(
        `/api/eval-cache?fen=${encodeURIComponent(fen)}&engine=${encodeURIComponent(ENGINE_NAME)}&depth=${engineDepth ?? 20}&multiPv=${targetLines}`,
        controller.signal,
      )
        .then((hit) => {
          if (cancelled || wanted.current !== fen) return;
          if (!hit || hit.lines.length === 0) return;
          const mapped: EngineInfo[] = hit.lines.map((l, idx) => ({
            depth: l.depth,
            multipv: idx + 1,
            score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 },
            pv: l.pv,
          }));
          const minDepth = mapped.reduce((min, l) => (l.depth > 0 ? Math.min(min, l.depth) : min), hit.depth);
          void putCachedEval(
            evalKey(fen, ENGINE_NAME),
            minDepth,
            mapped.length,
            mapped.map((l) => ({ pv: l.pv, score: l.score, depth: l.depth })),
          );
          applyExternal(mapped, minDepth, "cache");
        })
        .catch(() => undefined);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fen, enabled, engineDepth, engineLines, targetLines, net]);

  // Local Stockfish WASM search (skipped when local/shared Stockfish cache already satisfied depth & MultiPV).
  useEffect(() => {
    if (available === null || loadedNet !== net) {
      engine.current?.instance.stop();
      return;
    }
    if (!enabled || !fen) {
      engine.current?.instance.stop();
      return;
    }
    if (externalSatisfiedFen === fen) {
      engine.current?.instance.stop();
      return;
    }

    let cancelled = false;
    const cacheKey = evalKey(fen, engineLabel(net));
    const key = `${net}:${threads}:${hashMb}`;
    if (engine.current?.key !== key) {
      engine.current?.instance.destroy();
      const instance = new StockfishEngine({ threads, hashMb, net });
      engine.current = { instance, key };
      prevGameKeyRef.current = gameKey;
      setMultiThreaded(instance.multiThreaded);
      setError(null);
    } else if (prevGameKeyRef.current !== gameKey) {
      prevGameKeyRef.current = gameKey;
      engine.current.instance.newGame();
    }
    const activeInstance = engine.current.instance;
    let lastSavedDepth = 0;
    localProgressRef.current = { fen, depth: 0, lines: 0, done: false };

    activeInstance.analyze(fen, { depth: engineDepth, multiPv: targetLines }, (s) => {
      if (cancelled || engine.current?.instance !== activeInstance) return;
      if (s.error) {
        if (s.fen === wanted.current) setError(s.error);
        return;
      }
      if (s.fen === wanted.current) {
        const hasDeeperExternal = shouldSkipLocalUpdate(
          externalDepthRef.current,
          fen,
          s.depth,
          s.done,
          engineDepth,
          targetLines,
        );
        if (!hasDeeperExternal && s.lines.length > 0) {
          localProgressRef.current = {
            fen,
            depth: s.depth,
            lines: Math.min(engineLines, s.lines.length),
            done: s.done,
          };
          setSnapshot((prev) => (shouldPreserveVisibleLines(prev, s) ? prev : s));
          setSource("local");
        }
        const savedLines = s.lines.slice(0, engineLines).map((l) => ({
          pv: l.pv,
          score: l.score,
          depth: l.depth,
        }));
        const minLineDepth = savedLines.reduce(
          (min, l) => (l.depth > 0 ? Math.min(min, l.depth) : min),
          s.depth,
        );
        const milestone =
          savedLines.length >= 1 &&
          ((s.done && minLineDepth >= 1) ||
            (savedLines.length >= targetLines &&
              minLineDepth >= 12 &&
              minLineDepth >= lastSavedDepth + 4 &&
              minLineDepth % 4 === 0));
        if (milestone) {
          lastSavedDepth = minLineDepth;
          void putCachedEval(cacheKey, minLineDepth, savedLines.length, savedLines);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    available,
    loadedNet,
    net,
    fen,
    enabled,
    engineDepth,
    engineLines,
    targetLines,
    threads,
    hashMb,
    externalSatisfiedFen,
    gameKey,
  ]);

  const matching = snapshot && snapshot.fen === fen;
  return {
    snapshot: matching ? { ...snapshot, lines: snapshot.lines.slice(0, engineLines) } : null,
    source: matching ? source : null,
    multiThreaded,
    threads,
    net,
    loading: loadedNet === net ? null : loading,
    error,
  };
}

export type { EngineSnapshot };
