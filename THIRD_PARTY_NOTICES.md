# Third-party notices

Copyright (c) 2026 Debmalyo Barman · Kingside · Licensed under **AGPL-3.0-or-later** (see [LICENSE](LICENSE)).

Every runtime dependency and bundled asset, with its license. Update before adding anything (see docs/LICENSING.md).

## Runtime dependencies

| Package | Version | License | Source |
|---|---|---|---|
| next | 16.4.6 | MIT | https://github.com/vercel/next.js |
| react, react-dom | 19.3.1 | MIT | https://github.com/facebook/react |
| next-themes | 0.4.6 | MIT | https://github.com/pacocoursey/next-themes |
| radix-ui | 1.8.1 | MIT | https://github.com/radix-ui/primitives |
| class-variance-authority | 0.7.1 | Apache-2.0 | https://github.com/joe-bell/cva |
| clsx | 2.1.1 | MIT | https://github.com/lukeed/clsx |
| tailwind-merge | 3.7.0 | MIT | https://github.com/dcastil/tailwind-merge |
| lucide-react | 1.59.0 | ISC | https://github.com/lucide-icons/lucide |
| mongoose | 9.11.2 | MIT | https://github.com/Automattic/mongoose |
| zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |
| hono | 4.13.13 | MIT | https://github.com/honojs/hono |
| @hono/node-server | 2.1.5 | MIT | https://github.com/honojs/node-server |
| tsx | 4.23.15 | MIT | https://github.com/privatenumber/tsx |
| chessground | 9.2.1 | GPL-3.0-or-later | https://github.com/lichess-org/chessground |
| chessops | 0.15.1 | GPL-3.0-or-later | https://github.com/niklasf/chessops |
| stockfish (Stockfish.js, Stockfish 19 NNUE) | 19.0.1 | GPL-3.0 (engine), MIT (wrapper) | https://github.com/nmrugg/stockfish.js — engine source (`sf_19`): https://github.com/official-stockfish/Stockfish/tree/sf_19 |
| zustand | 5.0.15 | MIT | https://github.com/pmndrs/zustand |
| dexie | 4.4.7 | Apache-2.0 | https://github.com/dexie/Dexie.js |
| motion | 14.4.0 | MIT | https://github.com/motiondivision/motion |
| next-intl | 4.14.9 | MIT | https://github.com/amannn/next-intl |
| gifenc | 1.0.3 | MIT | https://github.com/mattdesl/gifenc |

## Development-only tools (not shipped)

| Package | Version | License | Source |
|---|---|---|---|
| @axe-core/playwright (accessibility tests) | 4.14.0 | MPL-2.0 | https://github.com/dequelabs/axe-core-npm |

The Stockfish license text ships with the engine at `frontend/public/engine/COPYING.txt`.

## Assets

| Asset | License | Source |
|---|---|---|
| Piece sets in `frontend/public/pieces/` | Per set (GPL-2.0+, GPL-3.0+, AGPL-3.0+, Apache-2.0, MIT, CC0, CC-BY-4.0, CC-BY-SA-4.0) — see `frontend/public/pieces/LICENSES.md` | lichess-org/lila `public/piece` at a pinned commit, via `scripts/fetch-pieces.mjs` |
| Board color palettes | Kingside's own (AGPL-3.0) | `frontend/lib/board-themes.ts` |
| Logo, site palette ("Midnight emerald") | Kingside's own (AGPL-3.0) | `frontend/components/logo.tsx`, `frontend/app/globals.css` |
| Home hero game: Anderssen vs Kieseritzky, 1851 | Public domain (game score) | `frontend/scripts/hero-evals.mjs` |
| Puzzles (MongoDB `puzzles` collection) | CC0-1.0 | Lichess puzzle database, https://database.lichess.org/#puzzles, via `packages/db/src/scripts/import-puzzles.ts` |
| Sounds | Kingside's own, synthesized at runtime with the Web Audio API (no audio files) | `frontend/lib/sounds.ts` |
| App icons (`frontend/public/icons/`) | Kingside's own (AGPL-3.0), rendered from the logo by `frontend/scripts/make-icons.mjs` | `frontend/public/icons/icon.svg` |
| Opening explorer statistics, Syzygy tablebase results (fetched live, cached, not stored) | lichess.org API terms; attributed in the UI ("data from lichess.org") | https://lichess.org/api#tag/Opening-Explorer, https://lichess.org/api#tag/Tablebase |
| Lichess cloud evaluations (stored engine lines of popular positions, fetched live through `/api/cloud-eval`, cached in memory, not stored) | lichess.org API terms; used for review opening positions | https://lichess.org/api#tag/Analysis |
| Home-page legendary games (Immortal, Evergreen, Opera, Lasker–Bauer 1889, Byrne–Fischer 1956, Kasparov–Topalov 1999) | Historical game scores (public records); titles and notes are Kingside's own | `frontend/scripts/hero-evals.mjs`, `frontend/scripts/legendary-evals.mjs` |
| Practice positions (`frontend/features/practice/positions.ts`) | Kingside's own selection of classic positions (chess facts); texts are Kingside's own | verified by `scripts/check-practice.mts` against tablebase.lichess.ovh / Stockfish |
| Win-model fit data (script only, not shipped) | CC0-1.0 | Lichess game dump 2024-01, https://database.lichess.org, via `scripts/fit-win-model.mjs` |
| Opening names + book positions (`frontend/public/data/openings.json`) | CC0-1.0 | lichess-org/chess-openings at a pinned commit, via `frontend/scripts/build-openings.mjs` |

## Fonts

| Font | License | Source |
|---|---|---|
| Geist, Geist Mono (via next/font/google) | SIL OFL 1.1 | https://github.com/vercel/geist-font |
| Instrument Serif (via next/font/google) | SIL OFL 1.1 | https://github.com/Instrument/instrument-serif |

UI components in `frontend/components/ui` follow shadcn/ui patterns (MIT).
