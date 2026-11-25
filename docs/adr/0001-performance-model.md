# ADR 0001 — Single-game performance estimate

Date: 2026-10-21 · Status: accepted (v1)

## Context
Game review shows a rating-like "performance" per player. It must be our own model (not Chess.com's
"Game Rating"), built from legal data, and honest about how noisy one game is.

## Data
- `scripts/fit-performance.mjs` sampled 226 players across ratings (≤ 30 per 200-point bucket) from six finished
  Lichess arenas (≤1500 rapid, ≤1700 blitz/superblitz, ≤2000 superblitz, hourly blitz/superblitz) and took up to 10
  of their computer-analysed, rated blitz/rapid/classical games via the public API (serial requests, ~1.5 s apart).
- 4,222 player-games of (Lichess accuracy, Lichess rating). Our accuracy formula reproduces Lichess's
  (golden test: 24/24 games within ±1), so their accuracy and ours are interchangeable.

## Finding
Accuracy in a single game is only weakly related to rating: median accuracy goes from ~69 % (600–800) to
~86 % (2200–2400). Fitting "median rating for each accuracy" compressed everything toward the sample mean
(94 % accuracy → 1700), which is useless as a performance figure.

## Decision
Fit the other direction — median accuracy per 200-point rating bucket (n ≥ 40), made monotone with pool adjacent
violators — and read it backwards: "this accuracy is typical of a player rated R". Knots live in
`packages/chess-core/src/performance-table.ts` (generated). Outside the knots the end slopes are extended;
results are clamped to 400–3000, rounded to 50, and hidden for players with < 10 moves.

## Consequences
- Expect ±400 or more between games for the same player; the UI labels it an estimate.
- Blitz/rapid/classical are pooled; time-control-specific curves and features beyond accuracy
  (blunder rate, ACPL, game length) are the next improvements.
- Data skews to 800–2200; above ~2400 and below ~600 the curve is extrapolated.
- Re-fit any time: `node scripts/fit-performance.mjs <arenaIds…>` or `--from-sample`.
