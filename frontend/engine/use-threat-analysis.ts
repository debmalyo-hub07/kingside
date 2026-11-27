// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen, threatFen } from "@kingside/chess-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { evalKey, getCachedEval, putCachedEval } from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { whenIdle } from "@/lib/when-idle";
import { type EngineSnapshot, engineLabel, prefetchEngine, StockfishEngine } from "./stockfish-engine";

export interface ThreatState {
  snapshot: EngineSnapshot | null;
  targetFen: string | null;
  /** True when Threat Mode is active but the side to move is in check (passing turn is illegal). */
  unavailableInCheck: boolean;
}

const THREAT_DEPTH = 14;
const THREAT_MULTI_PV = 2;

export function resolveThreatTarget(
  fen: string | null,
  enabled: boolean,
): { targetFen: string | null; unavailableInCheck: boolean } {
  if (!enabled || !fen) return { targetFen: null, unavailableInCheck: false };
  const swapped = threatFen(fen);
  if (!swapped) {
    let inCheck = false;
    try {
      inCheck = positionFromFen(fen).isCheck();
    } catch {
      inCheck = false;
    }
    return { targetFen: null, unavailableInCheck: inCheck };
  }
  try {
    if (positionFromFen(swapped).isEnd()) return { targetFen: null, unavailableInCheck: false };
  } catch {
    return { targetFen: null, unavailableInCheck: false };
  }
  return { targetFen: swapped, unavailableInCheck: false };
}

/**
 * Computes the opponent's strongest threats if the current side passed the turn.
 * Runs an isolated single-threaded Stockfish search using the active NNUE net (default full)
 * so the main analysis engine is never interrupted or slowed down.
 */
export function useThreatAnalysis(fen: string | null, enabled: boolean): ThreatState {
  const net = useSettings((s) => s.analysisNet);
  const [readyNet, setReadyNet] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const engine = useRef<StockfishEngine | null>(null);
  const wanted = useRef<string | null>(null);
  const ready = readyNet === net;

  const { targetFen, unavailableInCheck } = useMemo(() => resolveThreatTarget(fen, enabled), [fen, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const cancel = whenIdle(() => {
      void prefetchEngine(net).then(() => {
        if (live) setReadyNet(net);
      });
    });
    return () => {
      live = false;
      cancel();
    };
  }, [enabled, net]);

  useEffect(
    () => () => {
      engine.current?.destroy();
      engine.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !targetFen) {
      wanted.current = null;
      engine.current?.stop();
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    wanted.current = targetFen;
    setSnapshot(null);
    const cacheKey = evalKey(targetFen, engineLabel(net));

    void (async () => {
      const cached = await getCachedEval(cacheKey, THREAT_DEPTH, THREAT_MULTI_PV);
      if (cancelled || wanted.current !== targetFen) return;
      if (cached && cached.length > 0) {
        setSnapshot({
          fen: targetFen,
          lines: cached.map((l, i) => ({ depth: l.depth, multipv: i + 1, score: l.score, pv: l.pv })),
          depth: cached[0]?.depth ?? THREAT_DEPTH,
          done: true,
        });
        return;
      }
      if (!ready) return;

      if (engine.current && engine.current.net !== net) {
        engine.current.destroy();
        engine.current = null;
      }
      engine.current ??= new StockfishEngine({ threads: 1, hashMb: 32, net });
      const active = engine.current;
      active.analyze(targetFen, { depth: THREAT_DEPTH, multiPv: THREAT_MULTI_PV }, (s) => {
        if (cancelled || engine.current !== active || s.error) return;
        if (s.fen === wanted.current && s.lines.length > 0) {
          setSnapshot(s);
          if (s.done && s.depth >= 1) {
            const linesToSave = s.lines.slice(0, THREAT_MULTI_PV).map((l) => ({
              pv: l.pv,
              score: l.score,
              depth: l.depth,
            }));
            const minLineDepth = linesToSave.reduce(
              (min, l) => (l.depth > 0 ? Math.min(min, l.depth) : min),
              s.depth,
            );
            void putCachedEval(cacheKey, minLineDepth, linesToSave.length, linesToSave);
          }
        }
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, targetFen, ready, net]);

  return {
    snapshot: snapshot && snapshot.fen === targetFen ? snapshot : null,
    targetFen,
    unavailableInCheck,
  };
}
