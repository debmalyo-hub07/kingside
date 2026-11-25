// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ACCURACY_A,
  ACCURACY_B,
  ACCURACY_C,
  ACCURACY_UNCERTAINTY_BONUS,
  PRECISION_DECAY,
  PRECISION_FLOOR,
  PRECISION_POWER,
} from "./constants";

/**
 * Accuracy (0..100) of a single move from the mover's win% before and after it.
 * docs/ALGORITHMS.md §3.
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const diff = winBefore - winAfter;
  const raw = ACCURACY_A * Math.exp(-ACCURACY_B * diff) - ACCURACY_C + ACCURACY_UNCERTAINTY_BONUS;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Clean-room single-move precision (0..100) from expected-points loss (0..1 on the label curve).
 * Steeper than moveAccuracy so small inaccuracies and blunders spread clearly across 50..95.
 */
export function movePrecision(epLoss: number): number {
  if (!Number.isFinite(epLoss) || epLoss <= 0) return 100;
  const raw = 100 * Math.exp(-PRECISION_DECAY * epLoss);
  return Math.max(0, Math.min(100, raw));
}

/**
 * Complexity weight for Kingside Precision: balances sharp volatile middlegames above quiet or
 * already-decided positions (winBefore outside 5..95%).
 */
export function precisionComplexityWeight(winBefore: number, volatility: number): number {
  const clampedVol = Math.min(Math.max(Number.isFinite(volatility) ? volatility : 1, 0.5), 12);
  const volFactor = 0.65 + (clampedVol / 12) * 0.7; // 0.68 .. 1.35
  const liveFactor = winBefore >= 5 && winBefore <= 95 ? 1 : 0.45;
  return volFactor * liveFactor;
}

/**
 * Aggregates move precision scores using a complexity-weighted generalized power mean (p = -0.75).
 */
export function aggregatePrecision(precisions: readonly number[], weights: readonly number[]): number | null {
  if (precisions.length === 0) return null;
  if (precisions.every((x) => x >= 100)) return 100;
  let wSum = 0;
  let accSum = 0;
  for (let i = 0; i < precisions.length; i++) {
    const w = Math.max(0, weights[i] ?? 1);
    const x = Math.max(precisions[i] ?? 0, PRECISION_FLOOR);
    wSum += w;
    accSum += w * x ** PRECISION_POWER;
  }
  if (wSum <= 0) return null;
  const mean = (accSum / wSum) ** (1 / PRECISION_POWER);
  return Math.max(0, Math.min(100, mean));
}
