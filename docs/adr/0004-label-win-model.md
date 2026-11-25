# ADR 0004 — Label curve, node-budget reviews and calibration games

Date: 2026-10-23 · Status: accepted

## Context
Owner compared a Kingside review with a review of the same game on another site: labels differed a lot
(38/63 same), Brilliant and Great were missed, the rating estimate was 300 points high. The review used a
depth + time cap per position, so results depended on device speed.

## Decision
1. **Labels use their own curve**, `LABEL_WIN_K = 0.004` (ALGORITHMS §2a). Accuracy keeps the Lichess curve
   (golden-tested against Lichess, 24/24 games within ±1).
2. **Rating-fitted curve rejected for now.** `scripts/fit-win-model.mjs` fitted k per rating from 80,000
   evaluated games of the Lichess CC0 dump 2024-01 (k ≈ 0.0022 at 900 … 0.0047 at 2700). It reproduced fewer
   reference labels (40/56) than a fixed k = 0.004 (49/56). Kept as a script for future reference games.
3. **Node budget per position** (Fast 150k / Standard 400k / Deep 1.5M, MultiPV 2), cloud evals for the opening,
   and a **4× second pass** over up to 24 critical positions (ALGORITHMS §8b).
4. **Brilliant** allows a small cost (epLoss ≤ 0.04) and judges "completely winning without it" (≥ 90, ≈ +5.5) by the best
   alternative; **Great** = only move by a 10-point gap on the label curve, not when already ≥ 80.
5. **Performance anchored** to the PGN rating (55 %, ±600).
6. **Calibration fixtures**: reference reviews (labels are facts read from the owner's own review) + engine lines,
   checked by `test/calibration.test.ts`.

## Consequences
- First reference game: 62 % same label, 95 % within one step, Brilliant and Great found, estimate 2150/1900
  (reference 2200/1700). Remaining gaps are mostly Best vs Excellent (engine noise) and a few severities.
- Accuracy stays 4–7 points above the reference site's (its formula is not public).
- Standard review costs ≈ 63 × 400k + 24 × 1.6M nodes ≈ 64M nodes (~30–60 s on a 4-core laptop).
- More reference games raise confidence; each one is a new fixture.
