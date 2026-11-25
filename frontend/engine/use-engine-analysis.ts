// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useEffect, useRef, useState } from "react";
import { evalKey, getDb, putCachedEval, withTimeout } from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { whenIdle } from "@/lib/when-idle";
import {
  clampEngineHash,
  clampEngineThreads,
  type EngineNet,
  type EngineSnapshot,
  engineLabel,
  engineThreadsAvailable,
  prefetchEngine,
  StockfishEngine,
} from "./stockfish-engine";

export interface EngineState {
  snapshot: EngineSnapshot | null;
  multiThreaded: boolean;
  threads: number;
  net: EngineNet;
  /** Engine download progress 0..1 on first load; null once the engine is ready to start. */
  loading: number | null;
  /** Error message when the worker fails to initialize or crashes. */
  error: string | null;
}

/**
 * Analyzes `fen` with the browser engine while `enabled`. Pass fen = null for positions
 * that need no analysis (game over). Checks local Dexie eval cache first and writes completed
 * depth milestones back so navigating back to analyzed positions is instant.
 */
export function useEngineAnalysis(fen: string | null, enabled: boolean): EngineState {
  const { engineDepth, engineLines, engineThreads, engineHashMb, analysisNet: net } = useSettings();
  const [loading, setLoading] = useState<number | null>(0);
  const [loadedNet, setLoadedNet] = useState<EngineNet | null>(null);
  const engine = useRef<{ instance: StockfishEngine; key: string } | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wanted = useRef<string | null>(null);
  const [multiThreaded, setMultiThreaded] = useState(false);
  // Known only in the browser; null until mounted so server and client render the same.
  const [available, setAvailable] = useState<number | null>(null);
  const threads = clampEngineThreads(
    engineThreads > 0 ? Math.min(engineThreads, available ?? 1) : (available ?? 1),
  );
  const hashMb = clampEngineHash(engineHashMb);

  useEffect(() => {
    // Start the engine only once the page is up and idle.
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

  useEffect(() => {
    if (available === null || loadedNet !== net) return;
    if (!enabled || !fen) {
      wanted.current = null;
      engine.current?.instance.stop();
      setSnapshot(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setSnapshot(null);
    setError(null);
    wanted.current = fen;
    const cacheKey = evalKey(fen, engineLabel(net));

    void (async () => {
      let hitDepth = 0;
      // Check Dexie for an existing evaluation at or above the requested depth & PV count.
      try {
        const hit = await withTimeout(
          getDb()?.evals.get(cacheKey) ?? Promise.resolve(undefined),
          1500,
          undefined,
        );
        if (cancelled || wanted.current !== fen) return;
        if (hit && hit.multipv >= engineLines && hit.lines.length >= 1) {
          hitDepth = hit.depth;
          const cachedLines = hit.lines.slice(0, engineLines).map((l, idx) => ({
            depth: l.depth,
            multipv: idx + 1,
            score: l.score,
            pv: l.pv,
          }));
          const isSatisfied = engineDepth !== null && hit.depth >= engineDepth;
          setSnapshot({
            fen,
            lines: cachedLines,
            depth: hit.depth,
            done: isSatisfied,
          });
          if (isSatisfied) {
            engine.current?.instance.stop();
            return;
          }
        }
      } catch {
        // Best-effort local cache read.
      }

      if (cancelled || wanted.current !== fen) return;

      // Thread/hash changes get a fresh worker so the options apply cleanly.
      const key = `${net}:${threads}:${hashMb}`;
      if (engine.current?.key !== key) {
        engine.current?.instance.destroy();
        const instance = new StockfishEngine({ threads, hashMb, net });
        engine.current = { instance, key };
        setMultiThreaded(instance.multiThreaded);
        setError(null);
      }
      const activeInstance = engine.current.instance;
      let lastSavedDepth = hitDepth;

      activeInstance.analyze(fen, { depth: engineDepth, multiPv: engineLines }, (s) => {
        if (cancelled || engine.current?.instance !== activeInstance) return;
        if (s.error) {
          if (s.fen === wanted.current) setError(s.error);
          return;
        }
        // The previous search reports once more after it was replaced: ignore it.
        if (s.fen === wanted.current) {
          if (hitDepth === 0 || s.done || s.depth >= hitDepth) {
            setSnapshot(s);
          }
          const milestone =
            s.lines.length >= 1 &&
            ((s.done && s.depth >= 1) ||
              (s.lines.length >= engineLines &&
                s.depth >= 12 &&
                s.depth >= lastSavedDepth + 4 &&
                s.depth % 4 === 0));
          if (milestone) {
            lastSavedDepth = s.depth;
            void putCachedEval(
              cacheKey,
              s.depth,
              engineLines,
              s.lines.slice(0, engineLines).map((l) => ({
                pv: l.pv,
                score: l.score,
                depth: l.depth,
              })),
            );
          }
        }
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [available, loadedNet, net, fen, enabled, engineDepth, engineLines, threads, hashMb]);

  // Never hand out lines for a different position than the one asked for.
  return {
    snapshot: snapshot && snapshot.fen === fen ? snapshot : null,
    multiThreaded,
    threads,
    net,
    loading: loadedNet === net ? null : loading,
    error,
  };
}

export type { EngineSnapshot };
