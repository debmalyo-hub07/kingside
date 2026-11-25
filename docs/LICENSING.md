# LICENSING.md — what we may use

Project license: **AGPL-3.0-or-later**. Any dependency/asset must be compatible (MIT, BSD, Apache-2.0, ISC, MPL-2.0, GPL-3.0, AGPL-3.0,
LGPL, CC0, CC-BY, CC-BY-SA for assets). Record each in `THIRD_PARTY_NOTICES.md` (name, version, license, URL).
Unknown or "all rights reserved" = **do not use**. This file is guidance, not legal advice; ask a lawyer before commercial use.

## Allowed (verified category — still re-check license file at install time)

| Item | License | Use |
|---|---|---|
| Stockfish (official-stockfish/Stockfish) | GPL-3.0 | Native engine on server |
| `stockfish` npm (nmrugg/Stockfish.js) | GPL-3.0 (engine), MIT (wrapper) | Browser WASM engine. Ship source link + license in app "About/Licenses" page |
| `chessground` (lichess-org) | GPL-3.0 | Board UI |
| `chessops` (niklasf) | GPL-3.0 | Chess rules, PGN, FEN |
| `chess.js` | BSD-2 | Alternative/testing only |
| lichess-org/chess-openings | CC0 | Opening names/ECO |
| Lichess puzzle DB, game dumps (database.lichess.org) | CC0 | Puzzles, model fitting |
| Lichess public API, tablebase, cloud-eval, explorer | API terms | Fetch + cache, rate-limited, attribute "data from lichess.org" |
| Chess.com Published-Data API | ToS | Read user's public games only. ToS forbids copying Chess.com features/IP (board palettes, piece designs, sounds, feature names) |
| Lichess AGPL source (lila, lila-ws, scalachess) | AGPL-3.0 | Read for algorithm ideas; reimplement in TS with credit. Copying code is legally OK (we're AGPL) but keep credit + license notice |
| Open-source reviewers for reference (e.g. Chesskit, freechess) | check each LICENSE | Study only unless license verified compatible |

## Assets

- **Piece sets:** Lichess repo ships many sets with *individual* licenses (listed in lila `COPYING.md`). Use only sets whose license
  is CC0/CC-BY/CC-BY-SA/GPL/MIT, copy the attribution. Preferred: commission/create our own default set + a few free ones.
- **Boards:** colors/gradients are trivial but design our own palettes and names; do not reuse Chess.com palette names/values.
- **Sounds:** create or use CC0 (e.g. freesound CC0 packs). Never Chess.com sounds.
- **Fonts:** Google Fonts (OFL) self-hosted via `next/font`.
- **Icons:** Lucide (ISC) for UI. Classification glyphs: our own SVGs (`!!`, `!`, `★`, `✓`, `?!`, `?`, `??`, book) in our own colors.

## Forbidden

- Chess.com: logos, classification badge icons/colors, piece sets ("Neo" etc.), board themes, sounds, bot characters/avatars, coach
  voice lines, "Game Review" / "Game Rating" / "Coach" as our feature names, scraping undocumented endpoints.
- Lichess: logo, name in our brand, horse icon.
- Any scraped content (articles, lessons, videos) from either site.
- Commercial engines/NNUE nets with restrictive licenses. Only Stockfish's official nets (shipped with engine, GPL).

## Obligations from GPL/AGPL

- Public source code link in app footer ("Source" → repo) once deployed; AGPL §13 requires offering source to network users.
- Keep LICENSE + copyright notices; list modifications.
- WASM engine: provide link to exact engine source/version used.
