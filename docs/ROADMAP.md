# ROADMAP.md — build order

Each phase ends runnable + tested. Check boxes as done. Don't start next phase before acceptance passes.

## Phase 0 — Foundation
- [x] pnpm + Turborepo monorepo, `frontend/` (Next.js 16), `backend/` (Hono), `packages/chess-core`, `packages/uci`, `packages/db`, `packages/config`
- [x] Biome, Vitest, Playwright, strict TS
- [ ] GitHub CI workflow (when repo goes to GitHub)
- [x] Tailwind v4 + shadcn/ui, theme tokens, light/dark
- [x] MongoDB Atlas connection (Mongoose, cached connection), optional docker-compose (local mongo + Valkey), `.env.example` with `MONGODB_URI`
- [x] LICENSE (AGPL), THIRD_PARTY_NOTICES.md
- [x] Verify Atlas: `pnpm db:indexes` + backend `/api/health` → `db: "up"`
**Accept:** `pnpm dev` shows home page; lint/typecheck/test green.

## Phase 1 — Board + analysis board
- [x] chessground board component (drag, click-move, promotion dialog, flip, coords, arrows, highlights)
- [x] chessops game model: move tree with variations, PGN import/export, FEN load
- [x] Stockfish worker (full NNUE; multi-threaded when isolated), UCI layer, engine queue, MultiPV lines panel, depth selector
- [x] Eval bar, best-move arrow, keyboard navigation
- [x] Board palettes (10) + piece sets (14) picker, persisted locally (pulled forward from Phase 5)
- [x] Board editor page
**Accept:** paste any PGN/FEN → navigate, analyze live, edit position, export PGN.

## Phase 2 — Game review
- [x] chess-core: win%, accuracy, game accuracy, phases, classification (unit tests with crafted positions)
- [x] Golden tests: accuracy matches Lichess on 24 public games (±1)
- [x] Import: PGN paste, Lichess username, Chess.com username (backend routes, 10-min cache, 20 req/min rate limit)
- [x] Import: PGN file upload
- [x] Full-game analysis with progress + cancel
- [x] IndexedDB cache of analyzed positions (Dexie) — re-review of a 92-ply game: 0.3 s
- [x] Speed: depth + time cap per position, last position first — 92-ply game at Standard in 72 s incl. ~10 s engine load, measured in a throttled background window (foreground expected < 60 s; re-measure on real hardware)
- [x] Review UI: summary (accuracy, class counts, phase accuracy), eval graph with markers, classified move list, key moments, retry mistakes
- [x] Opening name/ECO for the reviewed game (CC0 dataset); "Review" button on the analysis board
- [x] Opening name on every position of the analysis board
- [x] Performance estimate — fitted on 4,222 Lichess games (ADR 0001)
- [x] Tuned on real games: Great needs a genuine only-move; Brilliant needs a newly hanging piece, not in check
- [ ] Later: time-control-specific performance curves; full static exchange evaluation for Brilliant
**Accept:** import 10 real games from each site, review completes < 60s on desktop (Standard depth), accuracy within ±1 of Lichess on golden set.

## Phase 3 — Puzzles
- [x] Puzzle import (`pnpm import:puzzles`): 227,655 Lichess puzzles (CC0) — popularity ≥ 85, ≥ 300 plays, RD ≤ 90, max 10k per 100-pt band; frame-by-frame zstd (pzstd) decoding
- [x] Puzzle API: next (rating window, theme, exclude), daily, by id — validated, rate-limited, injection-safe
- [x] Trainer UI: rated (local Glicko-2, verified on Glickman example), 32 themes, streak mode, 3-minute rush; any checkmate accepted
- [x] Puzzle profile + history stored in IndexedDB, with a timeout fallback so storage can never freeze the UI
- [x] Daily puzzle (deterministic per UTC date, stored on first request), share result (Web Share / clipboard)
**Accept:** solve flow works offline-tolerant, rating updates, daily puzzle same for everyone on a date.

## Phase 4 — Play vs bots
- [x] Bot levels (§9 ALGORITHMS): 10 personas 400–full strength, own avatar art, book-move variety, clocks (none/3+2/5+3/10+0/15+10), hint, takeback, resign
- [x] Game-end rules in chess-core (mate, stalemate, insufficient material, threefold, 50-move) + tests
- [x] Browser-tested: bot moves, clocks + increment, hint, takeback (then play on), resign, game saved, post-game review
- [x] Post-game → instant review; games saved to IndexedDB `games` (empty games are not saved)
- [x] Calibration runs documented (ADR 0002): ladder Pip < Rosa < Milo < Tara < Kenji confirmed by bot-vs-bot matches
- [ ] Later: bigger calibration samples for 1600+, human-like bots
**Accept:** each level beats/loses plausibly; game saved to local library.

## Phase 5 — Explorer, tablebase, polish
Owner picks (2026-10-22):
- Explorer: Lichess explorer API (masters + Lichess players) via backend with caching; fallback to own CC0 book (names + book moves) when unavailable.
- Sounds: own sounds synthesized with Web Audio (no asset files); on/off + volume in settings.
- Sharing (confirmed 2026-10-22, all 10): short link /g/<id> (MongoDB `sharedGames`, 1-year expiry, size cap), copy PGN, download .pgn, copy FEN, position image (PNG), animated GIF, embeddable board (iframe `/embed/g/<id>`), Web Share on phones, analysis link with FEN in URL, link opening at move N (`/g/<id>#N`).
- Tablebase: Lichess tablebase API via backend + cache; panel with W/D/L + DTZ/DTM per move, "TB" badge on eval bar.
- Notation: SAN + figurine (♞e5) setting.
- Library: list + search/filter (source, result, opening), open/review/share/delete, bulk PGN export.
- PWA: installable, offline analysis board + cached engine.
- i18n: next-intl scaffold, English only, strings in a message catalog.
- Accessibility: WCAG 2.2 AA audit + fixes (axe, keyboard, screen-reader move announcements, contrast) + typed move entry ("Nf3").
- Lighthouse: target ≥ 95 in all four categories on home + analysis (engine download excluded from performance).

- [x] Opening explorer panel (Masters / Online / Book tabs; online stats need `LICHESS_TOKEN`, else CC0 book) + `/openings`
- [x] Tablebase panel for ≤ 7 pieces (W/D/L, DTM/DTZ per move, 50-move-rule hints), "TB" badge on eval bar, `/endgames`
- [x] Settings page `/settings`: theme, boards, pieces, coordinates, arrows, animation, sounds (on/off, volume, test), notation (SAN / figurine), typed move input, engine defaults, explorer default, local data (clear cache / games, reset)
- [x] Sounds synthesized with Web Audio: move, capture, check, castle, promotion, game start/end, puzzle right/wrong, low time
- [x] Local library `/library`: search, source/result filters, analyze / review / share, multi-select delete, bulk PGN export; bot, reviewed, analysis and shared games saved (deduplicated by moves)
- [x] Sharing (all 10 ways): `/g/<id>` short link (+ `#N` start move), `/embed/g/<id>` iframe, Web Share, copy/download PGN, copy FEN, analysis link with FEN, PNG, animated GIF
- [x] PWA: manifest + icons, hand-written service worker (ADR 0003) — `/analysis` + engine work offline after one visit
- [x] i18n: next-intl, typed English catalog `frontend/messages/en.json` (~700 strings) — every screen, page titles, manifest, screen-reader move announcements; FEN/PGN and API errors translated by code. Only game data (PGN player names like "You") stays as stored
- [x] Accessibility: axe (WCAG 2.2 AA rules) e2e on 9 pages × light/dark × desktop/mobile + explorer/share dialog — 40/40 pass; fixed light-mode primary contrast, list markup, unlabeled select; skip link; screen-reader move announcements; typed move entry
- [ ] Lighthouse ≥ 95 — desktop 97–100 (a11y / best practices / SEO 100 everywhere). Mobile, after the speed pass
  (engine + opening book load after first paint, CSS animations instead of motion on home/template, lazy search dialog,
  per-page message bundles, mono font not preloaded; first-load JS −15%, HTML −20–30%): real throttled run LCP 1.8 s
  (meets the 2.0 s budget), score 80–85; simulated score 76–80. What is left is React hydration time (TBT 0.5–0.8 s
  on the 2-core test box) — re-measure on real hardware / after deploy before doing more
**Accept:** full feature set usable on mobile + desktop.

## Phase 5b — Accuracy, richer review, practice (owner picks 2026-10-23)
Owner compared reviews with another site and asked for better accuracy, richer reviews, a refreshed layout, practice
positions and more home-page games. Picks: A1 B1 C1 D1 E1 (recommended options), research notes in ADR 0004.
- [x] A — accuracy: node-budget search (Fast 150k / Standard 400k / Deep 1.5M), cloud evals for the opening
  (`/api/cloud-eval`), deeper second pass over ≤ 24 critical positions, label curve k = 0.004, new Brilliant / Great
  rules, performance anchored to PGN ratings, calibration test on a reference game (62 % same label, 95 % within one)
- [x] B — review: coach card (headline, eval before → after, up to two reasons, best line and punishing line you can
  play through, win chance, depth, time spent), retry with hint levels and engine-checked alternatives, threat arrow,
  next key moment, review options (labels on board, arrows, move times, key moments for), ACPL, coach summary,
  phase bars, material count, move times from `[%clk]`
- [x] C — layout: three columns on wide screens (review: summary · board · coach + moves; analysis: explorer · board ·
  engine + moves), engine lines playable up to any move
- [x] D — `/practice`: 27 verified positions in 6 sections (goals vs Stockfish, hints, take back, progress) +
  `/practice/drills` (mistakes from reviewed games, spaced repetition)
- [x] E — `/insights`: accuracy trend, phase accuracy, by colour, move quality, openings, what to work on (local only)
- [x] Home: six legendary games on the hero board (switchable) + "Legendary games" section (watch / review / analyze)
**Accept:** owner tests on his machine.

## Phase 6 — Deploy (when ready)
- [ ] Vercel/Netlify web with COOP/COEP, CDN engine files
- [ ] MongoDB Atlas network access + replace default atlasAdmin user with readWrite-only user on `kingside`; Upstash `REDIS_URL` for rate limit
- [ ] Backend on Render/Railway (+ optional server Stockfish in its Docker image)
- [ ] Source link in footer (AGPL)

## Later
Accounts (optional, Auth.js / Better Auth), cloud sync, Chess960, live play, tournaments, studies/courses, human-like bots.
