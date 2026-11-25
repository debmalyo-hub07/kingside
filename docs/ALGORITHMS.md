# ALGORITHMS.md — evaluation math (source of truth)

All code lives in `packages/chess-core`. All evals stored **White POV**. Constants in `packages/chess-core/src/constants.ts`.
Each section lists provenance so we stay legal: public formula / own design. We write our own code for all of it.

---

## 1. Inputs per position

For each ply `i` (position *before* move i = `P[i]`, after = `P[i+1]`):
- `lines[i]`: MultiPV top 3 from engine on `P[i]` → `{ pv: uci[], cp?: number, mate?: number, depth }` (White POV).
- `played[i]`: move actually played.
- `eval[i+1]`: best-line eval of `P[i+1]` (= eval after played move).
- If played move == `lines[i][0].pv[0]`, `eval[i+1]` may reuse line 0 (still prefer the deeper search of P[i+1]).

## 2. Win percentage (expected score)

Provenance: public logistic model used by Lichess (documented at lichess.org/page/accuracy, lila source AGPL).

```
cpClamped = clamp(cp, -1000, 1000)
winWhite  = 50 + 50 * (2 / (1 + exp(-0.00368208 * cpClamped)) - 1)      // 0..100
mate > 0  → winWhite(+1000) ≈ 97.5 ; mate < 0 → winWhite(-1000) ≈ 2.5
checkmate on the board → same cap in the winner's favour
(Lichess does exactly this; verified by test/golden-accuracy.test.ts: 24/24 real games within ±1 of Lichess accuracy.)
winMover  = mover == white ? winWhite : 100 - winWhite
```

This curve drives **accuracy** (§3–§4), the eval graph and key moments.

## 2a. Label curve (expected points behind move labels)

Move labels (§6) use the same logistic with a steeper slope, `LABEL_WIN_K = 0.004` (cp clamp ±1000, mate = ±1000):

```
labelWhite = 50 + 50 * (2 / (1 + exp(-0.004 * cpClamped)) - 1)
EP = label / 100   ;   epLoss[i] = max(0, EPmover(best of P[i]) - EPmover(after played))
```

Provenance (docs/adr/0004-label-win-model.md, 2026-10-23): on a reference review of a 1560-rated rapid game, the
reference site's own displayed evals reproduce 49/56 of its labels with k = 0.004, 45 with the Lichess slope and
40 with a rating-fitted slope (k ≈ 0.0028 at 1500, fitted by `scripts/fit-win-model.mjs` on 80,000 evaluated games
of the Lichess CC0 dump 2024-01). On our own engine lines k = 0.004 is also the best fit (sweep 0.0015–0.008).
The rating-fitted curve is therefore *not* used for labels; revisit as more reference games arrive.

## 3. Move accuracy

Provenance: Lichess public formula (curve fit), constants from lila `AccuracyPercent` (AGPL; reimplemented).

```
if winAfter >= winBefore: acc = 100
else:
  d   = winBefore - winAfter                     // mover POV, win% units
  acc = 103.1668100711649 * exp(-0.04354415386753951 * d) - 3.166924740191411 + 1   // +1 uncertainty bonus
  acc = clamp(acc, 0, 100)
```
`winBefore` = mover's win% at P[i] (best play), `winAfter` = mover's win% at P[i+1].

## 3a. Kingside Precision (clean-room complexity-calibrated score)

Alongside Lichess Classic Accuracy (§4), Kingside computes a clean-room **Kingside Precision** score (`packages/chess-core/src/accuracy.ts`):

```
movePrecision(epLoss) = clamp(100 * exp(-6.25 * max(0, epLoss)), 0, 100)
weight[i]             = clamp(0.65 + (volatility[i] / 12) * 0.70, 0.68, 1.35) * (5 <= winBefore <= 95 ? 1 : 0.45)
precision             = (Σ weight[i] * max(movePrecision[i], 1)^(-0.75) / Σ weight[i])^(-1 / 0.75)
```

Using a steeper exponential decay on label-curve expected-points loss (`PRECISION_DECAY = 6.25`) aggregated with a complexity-weighted generalized power mean (`PRECISION_POWER = -0.75`) penalizes costly tactical errors more clearly than arithmetic averaging while down-weighting already-decided garbage-time plies.

## 4. Game accuracy (per player)

```
N          = number of positions (plies + 1)
windowSize = clamp(floor(max(0, N - 2) / 10), 2, 8)  // matches upstream AccuracyPercent.scala (cps.size - 1) / 10
windows    = first (windowSize - 2) prefix windows of length windowSize, then sliding windows of windowSize over win% series (White POV)
weight[j]  = clamp(stddev(window_j), 0.5, 12)        // volatility weight per move j
for each color:
  wMean = Σ(acc_j * weight_j) / Σ weight_j
  hMean = harmonic mean of acc_j  (each acc floored at 1 so a 0 doesn't divide by zero)
  gameAccuracy = (wMean + hMean) / 2
```
Golden tests compare against Lichess-reported accuracy for 24 public games (tolerance ±1.0) — numbers obtained from their public API (`accuracy` field), not copied code.

## 5. Phase detection (opening / middlegame / endgame)

Provenance: own implementation of the well-known material/development heuristic (idea similar to Lichess "Divider").

Per position compute:
- `majorsMinors` = count of Q, R, B, N both sides.
- `backrankSparse` = white back rank has < 4 own pieces OR black back rank has < 4 own pieces.
- `mixedness` = number of overlapping 2x2 regions (49 total) that hold pieces of both colors. Own formula; tune.

```
middlegameStart = first ply where majorsMinors <= 10 OR backrankSparse OR mixedness >= 10
endgameStart    = first ply (≥ middlegameStart) where majorsMinors <= 6
Book moves affect classification only, never phase boundaries.
```
Phase accuracy = §4 applied to positions in that phase slice (needs ≥ 2 moves for that color else "—").

## 6. Move classification

Order of evaluation (first match wins):

| # | Class | Rule (mover POV) |
|---|---|---|
| 1 | **Forced** | Only one legal move. |
| 2 | **Book** | Position after move is in opening book (chess-openings EPD set or explorer masters count ≥ N) AND no earlier non-book move in game. |
| 3 | **Brilliant** | Rules §6.1. |
| 4 | **Great** | Rules §6.2. |
| 5 | **Miss** | Rules §6.3. |
| 6 | **Best** | Played == engine top move, or `epLoss ≤ 0.000…` (same eval within 1cp / identical mate). |
| 7 | **Excellent** | `0 < epLoss ≤ 0.02` |
| 8 | **Good** | `0.02 < epLoss ≤ 0.05` |
| 9 | **Inaccuracy** | `0.05 < epLoss ≤ 0.10` |
| 10 | **Mistake** | `0.10 < epLoss ≤ 0.20` |
| 11 | **Blunder** | `epLoss > 0.20` |

Band thresholds (provenance): public Chess.com help-center description of expected-points bands. Numbers are facts, not code.
Our implementation, icons, and colors are our own.

Mate edge cases:
- Had forced mate, played move still mates (longer) → Best/Excellent by mate distance delta (≤2 extra moves Excellent, else Good), never Blunder.
- Had mate, played move loses mate but still winning (win% ≥ 90) → use epLoss normally (win% curve keeps it ≤ Inaccuracy).
- Allowed opponent forced mate from non-lost position → Blunder.
- Already lost (winBefore < 5) — cap at Inaccuracy unless mate distance shortened a lot. Already won (winAfter > 97) — floor at Good.

### 6.1 Brilliant
All must hold:
1. Played move is best or `epLoss ≤ 0.04` (a sound sacrifice may cost a little against the top line; `< 1200` rated players allow `epLoss ≤ 0.05`).
2. **Sacrifice (v3 bitboard SEE — `packages/chess-core/src/see.ts`):** evaluated via full Stockfish-style static exchange evaluation (`seeGe`) using `chessops` attack/ray bitboards, iterative occupancy updates for X-ray sliders, en passant, promotions, and absolute king-pin checks:
   - Either a direct negative-SEE offer (`SEE ≤ -100 cp`) by a piece worth `≥ 3` (`≥ 1` pawn when player rating `< 1200`), OR
   - An indirect / counter-attack / desperado offer where another friendly piece (`≥ minValue`) is left statically losable (`SEE ≥ 100 cp` for opponent) and was either newly exposed by the move or newly attacked on the opponent's immediately preceding move.
3. Not a promotion, not checkmate on the spot, and the mover was not in check.
4. `winBefore ≥ 30` (not already losing badly), and **not completely winning without it**: the best alternative (engine line 2 when the played move is line 1, else the position before) is `≤ 90` (`≈ +5.5`).
5. `winAfter ≥ 50` (position good after).
6. **Surprise gating (`arXiv:2406.11895`):** when shallow probe lines (`depth ≤ 4`) are available, verifies that either the shallow search did not rank the sacrifice #1 or deeper search yielded `≥ +2%` expected-points gain (deep Pass 1 lines may confirm surprise, never veto when shallow probes are absent on cache hits).

### 6.2 Great
Implemented (v3): played move is best (or `epLoss ≤ 0.01`), `winBefore ≤ 80` (`≈ +3.5`, not already clearly winning), `winAfter ≥ 40`, and either:
- **Only move:** not a routine recapture, and the engine's 2nd line loses `≥ 10` expected-points `%`; OR
- **Turning point (`isTurningPoint`):** opponent's prior move was an error (`inaccuracy` / `mistake` / `blunder` / `miss`), win outlook swung by `≥ 15%` from losing/equal into equal/winning (`<40 → ≥40` or `≤60 → ≥65`), and the 2nd line loses `≥ 8%` (`≥ 10%` if the turning move is a recapture).

### 6.3 Miss
- Either **missed forced mate** (`bestMate > 0` dropped to a non-mating line with `epLoss > 0.08` and `winAfter ≥ 30`), OR
- Opponent's previous move was an error (`inaccuracy` / `mistake` / `blunder` / `miss`), best move at `P[i]` gives `winBest ≥ 70`, and played move leaves `winAfter ≤ winBest - 20`, `epLoss > 0.10`, and `winAfter ≥ 30` (below 30 falls through to Blunder).

### 6.4 Tests
`packages/chess-core/test/fixtures/` holds annotated PGNs with expected class per ply. Add every bug report as a fixture.
Calibration: `fixtures/reference/<game>.json` (PGN + reference labels, accuracy, rating estimate) and
`fixtures/calibration/<game>.json` (engine lines from `scripts/make-review-fixture.mts`, the app's Standard pipeline).
`test/calibration.test.ts` guards agreement (same label ≥ 60 %, within one step ≥ 93 %, reference Brilliant/Great
found). First reference game (2026-10-23): 62 % / 95 %, Brilliant and Great both found.
Property tests: classification is monotonic in epLoss for non-special classes; mirrored positions (color swap) give same class.

## 7. Performance estimate (rating estimate from one game)

**Current state (v2):** fitted on 4,222 Lichess player-games — median accuracy per rating bucket, read backwards (docs/adr/0001-performance-model.md). `PERFORMANCE_KNOTS_BY_TIME` stratifies knots by `timeClass` (`blitz`, `rapid`) when sufficient samples (`≥ 200`) exist, falling back to pooled `PERFORMANCE_KNOTS`. Clamped 400–3000, rounded to 50, hidden under 10 own moves.

**Anchoring (2026-10-23):** when the PGN carries the player's rating, the estimate starts there and moves
55 % of the way towards the accuracy-only estimate, at most ±600 (`anchoredPerformance`). One game is a noisy
signal; anchoring keeps a 1560 player with 88 % accuracy near 2150 instead of 2500.

Our own model — do NOT call it "Game Rating".
1. Dataset: Lichess CC0 monthly dump games with `%eval` on every move, rated, time control known.
2. Features per player: game accuracy, mean epLoss, blunder/mistake rate, average opponent rating not used (avoid leakage) — but time control bucket used.
3. Fit: per time-control bucket, monotonic regression (isotonic) or gradient boosting → rating; export as small lookup table / JSON coefficients into chess-core.
4. Output: point estimate rounded to 50, with confidence band; hide if < 10 own moves.
5. Script: `scripts/fit-performance-model.ts` (or Python in `scripts/py/`), reproducible, seed fixed. Document in ADR.

## 8. Key moments
In game order, at most 12: the **last book move** (where both sides left theory), the 5 biggest swings
(|Δwin%| ≥ 15, either side), and every Brilliant / Great / Mistake / Miss / Blunder. The review's "Next key moment"
steps through them, optionally for one side only.

## 8c. Move explanations
`explainMove` (`packages/chess-core/src/explain.ts`) gives up to two structured reasons per move; the UI words them.
Order: mate facts (forces mate in n — counting the move played —, allows mate in n, missed mate in n; "allows mate" is skipped when the mover was already being mated), the sacrifice of a Brilliant move, "only move" / "punishes" for Great, then for Inaccuracy or worse: the engine's reply takes a hung piece (≥ minor, not a genuine recapture), or forks, or tactical reply/missed motifs along `replyLine` / `bestLine` (**Back-Rank Threat**, **Double Check**, **Discovered Attack**, **Pin**, **Skewer**, **Deflection**, **Trapped Piece** via `seeGe` + `chessops` rays, with missed best-line motifs surfaced as `missedTactic`), material lost along the reply line (≥ 2 pawns over 4 plies), material the best line would have won (≥ 2 over 5 plies). Standout/good moves surface newly executed tactical motifs along the played continuation. Fallback: outlook change or `punishes`.
ACPL per player: mean of max(0, cp loss) per own move, cp clamped ±1000, mates = ±1000.

## 8a. Book moves and opening names
`frontend/public/data/openings.json` is built from lichess-org/chess-openings (CC0) by
`frontend/scripts/build-openings.mjs`. Book = every position reached along any named line (EPD = first 4 FEN fields).
A move is Book while it and every earlier move land on book positions. Opening name = deepest named position
within the book prefix (falls back to the deepest named position anywhere in the game).

## 8b. Review engine settings
1. **Ephemeral cloud first:** opening positions (first 20 plies) query `/api/cloud-eval` (accepting depth `≥ 30` even with `1` PV for Pass 1). Lichess cloud-eval responses stay strictly in backend RAM `TtlCache` and browser Dexie (`lichess-cloud`) — **never** stored in MongoDB `EvalCache`.
2. **Shared Kingside EvalCache + Pass 1 (`MultiPV = 1`):** remaining positions check browser Dexie (`Stockfish 19 NNUE|nodes`) and batch `POST /api/eval-cache/lookup` (MongoDB `EvalCache`, 90-day TTL, Kingside Stockfish evaluations only), then compute misses with `MultiPV = 1` (Fast 150k, Standard 400k, Deep 1.5M) in reverse game order so TT carries over.
3. **Second look (`MultiPV = 3`, `4×` nodes) & surprise probe:** `criticalPositions` picks up to 24 positions (sacrifices, errors, turning-point candidates, non-obvious best moves, swings `≥ 8%`, plus 1-PV cloud hits if critical) and searches at `MultiPV = 3` (`4×` nodes), running a fast `depth = 2` shallow probe on sacrifice candidates (`arXiv:2406.11895`, cached locally in browser Dexie).
4. **Mobile/WASM fallback:** when browser WASM/Workers fail, reviews fall back to serialized native Stockfish (`POST /api/engine/eval`, `Threads = 1`, `Hash = 16–32 MB`, `MultiPV ≤ 2`, recording actual capped node/MultiPV limits in cache).
Finished positions (mate/stalemate/insufficient) are not searched. Results are cached per position in IndexedDB and shared `EvalCache` asynchronously.

## 9. Bots

Provenance: Stockfish UCI options (GPL engine; we only send options).

| Bots | Target | Method (implemented) |
|---|---|---|
| Pip / Rosa / Milo | ~400 / 700 / 1000 | Stockfish `UCI_LimitStrength` at the 1320 floor, plus `humanLikeMistakeMove` (avoids aimless king shuffles 85% of the time) on 40 % / 25 % / 12 % of moves |
| Tara … Atlas | 1320 … 2800 | `UCI_LimitStrength true`, `UCI_Elo n`, progressive 1.2–2.0 s per move and `bookPlies` 8–12 |
| Kingside Max | full | No limit, 2 s per move |

Calibration and the rejected first approach: docs/adr/0002-bot-strength.md.
All bots play a random opening-book move for their first plies (85 % chance per move, up to ply 10) for variety.

- Bot personas: original names + original avatar art (no Chess.com characters).
- Opening variety: first 2–6 plies chosen from book weighted by popularity.
- Add think-delay (human-feel) in UI, not engine.
- Future: human-like bots via Maia models (check license of chosen model before adding; must be AGPL-compatible).
- Calibrate: self-play bot-vs-bot + vs fixed-Elo Stockfish; record results in `docs/adr/`.

## 10. Puzzle rating
Local Glicko-2 per device (initial 1500, RD 350). Puzzle rating from Lichess CSV. Store in Dexie. Daily puzzle not rated-affecting optional.

## 11. Practice positions
Curated positions (`frontend/features/practice/positions.ts`) with a goal, played against Stockfish (400k nodes per
reply). `practiceStatus` (chess-core `practice.ts`) judges after every move with the engine's score of the position:
- **mate (in n):** success on checkmate (within n own moves); failure on stalemate/repetition/50-move draw, after n
  own moves, or when the player's eval drops below +1.5.
- **promote:** success once the player has promoted and is still ≥ +1.5 after the reply; failure below +1.5 or on a draw.
- **draw (n):** success after n own moves while not worse than −2.5, or on any draw; failure below −2.5 or when mated.
- **advantage (cp, n):** success when the player's eval reaches cp within n own moves.
Every goal is verified by `scripts/check-practice.mts` (Syzygy tablebase for ≤ 7 pieces, Stockfish otherwise).

**Drills from your games:** every Mistake / Miss / Blunder of a reviewed game (only the device owner's side when
known) becomes a drill: find a better move than the one played. Accepted: the engine's best move, or any move that
loses ≤ 2 label-curve points against it (engine lines of the position, else a 300k-node check). Leitner boxes:
correct → next box (due after 1, 3, 7, 16, 35 days), wrong or answer shown → box 0, due in 10 minutes.
