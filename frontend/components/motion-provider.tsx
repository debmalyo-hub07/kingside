// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type * as React from "react";

const loadFeatures = () => import("@/lib/motion-features").then((mod) => mod.domMax);

/**
 * Motion with lazily loaded features: components use the small `m.*` elements and the animation
 * code arrives in its own chunk (keeps the first-load JavaScript small). `strict` forbids `motion.*`.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
