// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs work after the page has loaded and the browser is idle, so heavy downloads (the 94 MB engine,
// opening book) never compete with the first paint. Returns a cancel function.
"use client";

export function whenIdle(fn: () => void, timeoutMs = 2000): () => void {
  let cancelled = false;
  let idleId: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => !cancelled && fn(), { timeout: timeoutMs });
    } else {
      timer = setTimeout(() => !cancelled && fn(), 200);
    }
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", run);
    if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
    if (timer) clearTimeout(timer);
  };
}
