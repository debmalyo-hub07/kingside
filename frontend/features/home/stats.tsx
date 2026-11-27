// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BOARD_THEMES } from "@/lib/board-themes";
import { PIECE_SETS } from "@/lib/piece-sets";
import { useInView } from "@/lib/use-in-view";
import { Reveal } from "./reveal";

const STATS = [
  { value: 100, suffix: "%", label: "free" },
  { value: 19, prefix: "SF ", label: "engine" },
  { value: PIECE_SETS.length, label: "pieces" },
  { value: BOARD_THEMES.length, label: "boards" },
  { value: 0, label: "accounts" },
] as const;

function CountUp({ to, prefix = "", suffix = "" }: { to: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  // Server HTML shows the final number; the count-up only runs in the browser when scrolled into view.
  const [n, setN] = useState(to);
  useEffect(() => {
    if (!inView || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1400);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, to]);
  return (
    <span ref={ref}>
      {prefix}
      {n}
      {suffix}
    </span>
  );
}

export function Stats() {
  const t = useTranslations("home.stats");
  return (
    <Reveal>
      <section
        aria-label={t("label")}
        className="panel-solid grid grid-cols-2 gap-6 rounded-3xl px-6 py-8 sm:grid-cols-3 lg:grid-cols-5"
      >
        {STATS.map((s) => (
          <div key={s.label} className="text-center">
            <p className="kpi-num text-3xl text-foreground sm:text-4xl">
              <CountUp
                to={s.value}
                prefix={"prefix" in s ? s.prefix : ""}
                suffix={"suffix" in s ? s.suffix : ""}
              />
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">{t(s.label)}</p>
          </div>
        ))}
      </section>
    </Reveal>
  );
}
