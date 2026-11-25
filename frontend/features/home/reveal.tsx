// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type * as React from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Fades/rises its children in once when scrolled into view (CSS transition + IntersectionObserver,
 * no animation library). Content is visible in the server HTML; only elements that start below the
 * fold are hidden after mount, so nothing above the fold ever waits for JavaScript.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  /** Render as a list item (inside <ul>/<ol>) instead of a div. */
  as?: "div" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"static" | "hidden" | "shown">("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already on screen: leave as is
    setState("hidden");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      className={[
        className,
        state !== "static" &&
          "transition-[opacity,translate] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
        state === "hidden" && "translate-y-6 opacity-0",
      ]
        .filter(Boolean)
        .join(" ")}
      style={state === "shown" && delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: React.ReactNode;
  text?: string;
}) {
  return (
    <Reveal className="mx-auto mb-10 max-w-2xl text-center">
      <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-primary uppercase">{eyebrow}</p>
      <h2 className="font-display text-4xl leading-tight tracking-tight sm:text-5xl">{title}</h2>
      {text && <p className="mt-4 text-muted-foreground">{text}</p>}
    </Reveal>
  );
}
