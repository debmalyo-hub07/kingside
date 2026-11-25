// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside service worker (hand-written, no build step). Makes the analysis board work offline:
// - pages: network first, cached copy when offline, /offline as last resort
// - hashed build assets, pieces, data, icons: cache first
// - Stockfish engine (~94 MB): cache first in its own cache, so it is downloaded once
// Only same-origin GET requests are handled; the backend API (other origin) is never cached here.

const VERSION = "v1";
const PAGES = `ks-pages-${VERSION}`;
const ASSETS = `ks-assets-${VERSION}`;
const ENGINE = "ks-engine-sf19";
const KEEP = [PAGES, ASSETS, ENGINE];
const PRECACHE_PAGES = ["/offline", "/analysis", "/"];
const MAX_ASSETS = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(PAGES);
      const assets = await caches.open(ASSETS);
      for (const url of PRECACHE_PAGES) {
        try {
          const res = await fetch(url, { credentials: "same-origin" });
          if (!res.ok) continue;
          await pages.put(url, res.clone());
          // Also fetch the build chunks a page needs, so it can start offline.
          const html = await res.text();
          const chunks = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) ?? [])];
          await Promise.all(chunks.map((c) => assets.add(c).catch(() => undefined)));
        } catch {
          // Offline during install: pages get cached on first visit instead.
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("ks-") && !KEEP.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
    if (cacheName === ASSETS) void trim(cache, MAX_ASSETS);
  }
  return res;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") await cache.put(request, res.clone());
    return res;
  } catch {
    const url = new URL(request.url);
    return (
      (await cache.match(request, { ignoreSearch: false })) ||
      (await cache.match(url.pathname)) ||
      (await cache.match("/offline")) ||
      new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Range requests (media) would be stored incorrectly; let the network handle them.
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.startsWith("/engine/")) {
    event.respondWith(cacheFirst(request, ENGINE));
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/pieces/") ||
    url.pathname.startsWith("/data/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(cacheFirst(request, ASSETS));
  }
});
