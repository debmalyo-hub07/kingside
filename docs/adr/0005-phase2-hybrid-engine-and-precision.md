# ADR 0005 — Phase 2 Two-Pass Pipeline, Shared EvalCache, Server Fallback & Dual Precision

Date: 2026-11-25 · Status: accepted

## Context
Running Pass 1 at `MultiPV = 2` halved effective search depth per node budget compared to single-PV search (`fishnet`), while constrained mobile devices failed when browser WASM (`SharedArrayBuffer` / memory limits) could not start. Separately, third-party Lichess cloud-eval data could not be stored persistently in MongoDB under API terms, and club players wanted a complexity-calibrated score alongside Lichess's published `AccuracyPercent` formula.

## Decisions
1. **Two-pass review (`MultiPV = 1` → `MultiPV = 3`):** Pass 1 runs `MultiPV = 1` (and accepts valid depth `30+` Lichess cloud hits even with `1` PV), while Pass 2 re-searches up to 24 `criticalPositions` (sacrifices, errors, turning points, non-obvious best moves, swings `≥ 8%`) at `MultiPV = 3` with `4×` nodes plus a `depth = 2` shallow surprise probe (`arXiv:2406.11895`) on sacrifice candidates.
2. **Strict `EvalCache` separation:** MongoDB `EvalCache` (90-day TTL, normalized 4-field EPD keys, legal-PV validation) accepts strictly Kingside's own Stockfish 19 evaluations (`Stockfish 19 NNUE|nodes` / `Lite`). Lichess `cloud-eval` remains strictly in backend ephemeral RAM `TtlCache` and browser IndexedDB (`lichess-cloud`).
3. **Render Free hybrid native Stockfish fallback:** `backend/Dockerfile` builds a multi-stage Node 24 image with native Stockfish running as a non-root user (`Threads = 1`, `Hash` clamped `16–32 MB`, serialized queue cap `4`, toggleable via `SERVER_ENGINE_ENABLED`) serving `POST /api/engine/eval` (`MultiPV ≤ 2`, capped nodes).
4. **Lichess window parity + Kingside Precision + SEE v3:** Fixed `volatilityWeights` window sizing (`floor(max(0, n - 2) / 10)`), retained Lichess `AccuracyPercent` as Classic Accuracy, added clean-room Kingside Precision (`PRECISION_DECAY = 6.25`, complexity-weighted power mean `p = -0.75`), upgraded `Brilliant` with bitboard `seeGe` + surprise gating, added turning-point `Great`, broadened `Miss`, and added ray/bitboard tactical motifs (`pins`, `skewers`, `discoveredAttack`, `doubleCheck`, `trapsPiece`, `backRank`, `deflection`) in `explain.ts`.

## Consequences
- Reviews run ~2× deeper or faster in Pass 1 while preserving `MultiPV = 3` accuracy on decisive moments.
- Shared `EvalCache` accelerates popular positions across devices legally without touching third-party cloud data.
- Render Free stays safely under 512 MB RAM even when serving mobile fallback requests.
