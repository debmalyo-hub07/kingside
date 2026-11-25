# ADR 0002 — Bot strength ladder

Date: 2026-10-22 · Status: accepted (v1)

## Context
Phase 4 needs ten bots from ~400 to full Stockfish strength that get reliably stronger from one to the next.
Stockfish's own limiter (`UCI_LimitStrength` + `UCI_Elo`) only goes down to 1320.

## What we tried
1. **Bots below 1320 = our own sampler** (Skill Level + shallow MultiPV search + softmax choice + occasional
   random candidate). Calibration (`scripts/calibrate-bots.mts`, 6 games per pair, single-thread full NNUE):
   Rosa–Pip 6/6, Milo–Rosa 3.5/6, but **Tara (UCI_Elo 1320) 0/6 vs Milo ("1000")** — the sampler was far stronger
   than its label.
2. Giving the limited bots more time (0.3 s → 1.5 s per move) did not change that (still 0/6).

## Decision
Bots below the engine floor use **the 1320 limiter plus deliberate random moves**: each move has a chance to be a
uniformly random legal move — Pip 40 %, Rosa 25 %, Milo 12 %. More random moves can only make a bot weaker, so
the order is guaranteed by construction. Limited bots (1320–2800) think 1.5 s per move; Kingside Max is
unlimited at 2 s per move. The "sample" method stays in `chess-core` (tested) for future personas.

## Calibration (after the change, 2026-10-22)
| Match | Score (stronger bot) |
|---|---|
| Rosa (700) vs Pip (400) | 6 / 6 |
| Milo (1000) vs Rosa (700) | 9 / 12 (a 6-game run gave 2 / 6 — small samples are noisy) |
| Tara (1320) vs Milo (1000) | 6 / 6 |
| Kenji (1600) vs Tara (1320) | 5 / 6 |

Bots from 1320 up rely on Stockfish's own Elo calibration; displayed numbers are approximate, not human ratings.

## Consequences
- Easiest bots make obviously random moves — fine for beginners, but they don't "feel human".
- Next steps: larger match samples for the upper ladder, and human-like play (e.g. Maia-style models, licence permitting).
- Re-run any time: `cd packages/db && npx tsx ../../scripts/calibrate-bots.mts pip:rosa rosa:milo 12`.
