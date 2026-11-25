// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { ALL_NAV_ITEMS, type NavItem } from "@/lib/site-nav";
import { cn } from "@/lib/utils";
import { Reveal, SectionHeading } from "./reveal";

/** Card with a soft spotlight that follows the cursor. */
function SpotlightCard({ item, wide }: { item: NavItem; wide?: boolean }) {
  const t = useTranslations("nav.items");
  const common = useTranslations("common");
  const Icon = item.icon;
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
  };
  const body = (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(22rem circle at var(--x, 50%) var(--y, 50%), var(--glow-emerald), transparent 70%)",
        }}
      />
      <div className="relative flex h-full flex-col">
        <div className="mb-6 flex items-start justify-between">
          <span className="grid size-12 place-items-center rounded-2xl border bg-secondary text-primary transition group-hover:scale-110 group-hover:border-primary/40">
            <Icon className="size-5" />
          </span>
          {item.soon ? (
            <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gold uppercase">
              {common("soon")}
            </span>
          ) : (
            <ArrowUpRight className="size-5 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
          )}
        </div>
        <h3 className="text-lg font-semibold">{t(`${item.id}.title`)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t(`${item.id}.description`)}</p>
      </div>
    </>
  );
  const className = cn(
    "glass group relative block h-full overflow-hidden rounded-3xl p-6 transition-colors",
    wide && "sm:col-span-2",
    item.soon ? "opacity-75" : "hover:border-primary/40",
  );
  return (
    <div
      className={cn(
        "h-full transition-transform duration-300 motion-reduce:transition-none",
        !item.soon && "hover:-translate-y-1",
        wide && "sm:col-span-2",
      )}
    >
      {item.soon ? (
        <div className={className}>{body}</div>
      ) : (
        <Link href={item.href} className={className} onMouseMove={onMove}>
          {body}
        </Link>
      )}
    </div>
  );
}

export function Features() {
  const t = useTranslations("home.features");
  return (
    <section id="features" className="scroll-mt-24">
      <SectionHeading
        eyebrow={t("eyebrow")}
        title={t.rich("title", { em: (c) => <em className="text-gradient">{c}</em> })}
        text={t("text")}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_NAV_ITEMS.map((item, i) => (
          <Reveal key={item.href} delay={(i % 3) * 0.06} className="h-full">
            <SpotlightCard item={item} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
