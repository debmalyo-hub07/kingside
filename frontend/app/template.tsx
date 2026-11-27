// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type * as React from "react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

// The first page load renders without the transition so content is visible before JavaScript runs
// (good LCP); later client-side navigations fade in (CSS only, honours reduced motion).
let hydrated = false;

/** Re-mounts on every navigation: gentle fade/rise page transition. */
export default function Template({ children }: { children: React.ReactNode }) {
  const animate = hydrated;
  useEffect(() => {
    hydrated = true;
  }, []);
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        animate &&
          "animate-in fade-in slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none",
      )}
    >
      {children}
    </div>
  );
}
