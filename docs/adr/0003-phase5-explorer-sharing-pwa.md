# ADR 0003 — Phase 5: explorer access, sharing, offline, i18n

Date: 2026-10-22 · Status: accepted

## Opening explorer needs a Lichess token
Since 2025 `explorer.lichess.ovh` answers `401` without authentication (checked 2026-10-22). The backend therefore
reads an optional **`LICHESS_TOKEN`** (personal API token, no scopes) and sends it as `Authorization: Bearer`.
- No token, or Lichess rejects it → `/api/explorer/status` reports `{ available: false }`; the frontend asks once
  and shows our own CC0 opening book (names + book moves from `openings.json`) instead. No failing requests are made.
- Requests to lichess.ovh hosts are serialized; a `429` pauses them for 60 s. Explorer results cached 6 h, tablebase
  24 h (in-memory `TtlCache`; move to Redis with the rest of rate limiting at deploy).
- The tablebase (`tablebase.lichess.ovh`) is still public and needs no token.

## Sharing
- Short links: `POST /api/share` stores a normalized PGN (re-serialized by chess-core, ≤ 1000 plies, ≤ 1 MB with
  analysis) plus an optional compact analysis (`whiteWin[]`, `classes[]`, accuracy) in `sharedGames` (TTL 1 year).
  Ids are 8 random base62 characters (`crypto.randomBytes`, no extra dependency). Rate limit 10 links/min/IP.
- `/g/<id>` (viewer) and `/embed/g/<id>` (iframe). Only `/embed/*` may be framed (`frame-ancestors *` + CORP
  `cross-origin`); every other page keeps `X-Frame-Options: DENY` + `frame-ancestors 'none'`.
- PNG and GIF are drawn in the browser on a canvas with the user's board palette and piece set. GIF encoding uses
  **gifenc** (MIT, ~10 KB, no deps); both are loaded only when the user asks for an image.

## Offline (PWA): hand-written service worker instead of Serwist
CLAUDE.md named Serwist. `@serwist/next` hooks into webpack, and the Turbopack variant pulls esbuild in as a peer
dependency. The caching we need is small, so `frontend/public/sw.js` (~100 lines, no build step) does it:
pages network-first with offline fallback, hashed assets / pieces / data cache-first, the 94 MB engine cache-first in
its own cache (downloaded once). Registered only in production builds. Verified: after one online visit,
`/analysis` reloads offline with a working engine.

## i18n: next-intl without locale routing
`next-intl` 4 with `i18n/request.ts` returning English; no `/en` URL prefix. Messages are typed from
`messages/en.json` (`global.d.ts`), so a missing key is a type error. Adding a language = add `messages/<locale>.json`
and choose the locale in `i18n/request.ts` (cookie / Accept-Language).

## Sounds
Synthesized with the Web Audio API (`frontend/lib/sounds.ts`): no audio files, nothing to license. Boards play a
move sound only when `sound` is set on `<ChessBoard>` (not on the home page demo board).

## Speed pass (mobile Lighthouse)
- Engine (~94 MB) and opening book start only after `load` + idle (`lib/when-idle.ts`); home demo board autoplay
  starts a moment later.
- Home page and the page transition use CSS animations (tw-animate-css + a tiny IntersectionObserver `Reveal`)
  instead of `motion`. Pages that still animate with motion (play, puzzles) wrap themselves in `<MotionProvider>`
  (`LazyMotion` with async `domAnimation`, `m.*` components only).
- The search dialog (Ctrl+K) is loaded on first use.
- Messages: the layout sends only shared namespaces to the browser; each page adds its own via `<PageMessages>`
  (`frontend/i18n/client-messages.tsx`). A namespace missing from a page shows up as a console error in tests.
