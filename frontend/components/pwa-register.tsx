// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js in production builds (offline analysis board + cached engine).
 * In development it removes a worker left over from an earlier production run: its cache-first copies of
 * /_next/static chunks would otherwise serve old code to the dev server (hydration errors).
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then(async (regs) => {
        if (regs.length === 0) return;
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith("ks-") && !k.includes("engine")).map((k) => caches.delete(k)),
        );
        window.location.reload();
      });
      return;
    }
    const register = () =>
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
