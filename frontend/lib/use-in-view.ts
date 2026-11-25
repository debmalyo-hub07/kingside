// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { type RefObject, useEffect, useState } from "react";

/** True while (or, with `once`, after) the element is at least `amount` visible. Tiny IntersectionObserver hook. */
export function useInView(
  ref: RefObject<Element | null>,
  { amount = 0, once = false, margin = "0px" }: { amount?: number; once?: boolean; margin?: string } = {},
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        const visible = !!entry?.isIntersecting;
        setInView(visible);
        if (visible && once) io.disconnect();
      },
      { threshold: amount, rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, amount, once, margin]);
  return inView;
}

/** prefers-reduced-motion, read after mount (false during SSR and the first client render). */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}
