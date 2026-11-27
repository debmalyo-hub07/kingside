// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { NAV_GROUPS, type NavItem, type NavItemId } from "@/lib/site-nav";
import { cn } from "@/lib/utils";
import { Reveal, SectionHeading } from "./reveal";

const FLAGSHIP_IDS = new Set<NavItemId>(["analysis", "review"]);
const CURATED_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
const FLAGSHIP_ITEMS: NavItem[] = [
  CURATED_ITEMS.find((i) => i.id === "analysis"),
  CURATED_ITEMS.find((i) => i.id === "review"),
].filter((i): i is NavItem => Boolean(i));
const TOOL_ITEMS: NavItem[] = CURATED_ITEMS.filter((i) => !FLAGSHIP_IDS.has(i.id));

function FlagshipVisual({ id }: { id: NavItemId }) {
  if (id === "analysis") {
    return (
      <div
        aria-hidden
        className="surface-well mt-4 flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-xs"
      >
        <div className="flex flex-1 items-end gap-1">
          {[32, 46, 38, 62, 54, 78, 86].map((h, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: decorative static eval preview bars
              key={i}
              className="w-2 rounded-t bg-primary/70"
              style={{ height: `${Math.round(h * 0.34)}px`, opacity: 0.45 + i * 0.08 }}
            />
          ))}
        </div>
        <div className="space-y-0.5 text-right font-mono tabular-nums">
          <p className="text-[11px] font-semibold text-primary">+2.45 · d28</p>
          <p className="text-[10px] text-muted-foreground">1. Nf3 Ng4 2. Bc4</p>
        </div>
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="surface-well mt-4 flex items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 text-xs"
    >
      <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold">
        <span
          className="rounded px-1.5 py-0.5"
          style={{ backgroundColor: "var(--class-brilliant-bg)", color: "var(--class-brilliant-fg)" }}
        >
          !!
        </span>
        <span
          className="rounded px-1.5 py-0.5"
          style={{ backgroundColor: "var(--class-best-bg)", color: "var(--class-best-fg)" }}
        >
          ★
        </span>
        <span
          className="rounded px-1.5 py-0.5"
          style={{ backgroundColor: "var(--class-blunder-bg)", color: "var(--class-blunder-fg)" }}
        >
          ??
        </span>
      </div>
      <div className="text-right font-mono tabular-nums">
        <span className="text-sm font-semibold text-primary">93.4</span>
        <span className="ml-1.5 text-[10px] text-muted-foreground">≈ 2340</span>
      </div>
    </div>
  );
}

/** Card with a soft spotlight that follows the cursor. */
function SpotlightCard({ item, flagship }: { item: NavItem; flagship?: boolean }) {
  const t = useTranslations("nav.items");
  const tf = useTranslations("home.features");
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
        <div className="mb-6 flex items-start justify-between gap-2">
          <span
            className={cn(
              "grid size-12 place-items-center rounded-2xl border bg-secondary text-primary transition group-hover:scale-110 group-hover:border-primary/40",
              flagship && "border-primary/30 bg-primary/15",
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="flex items-center gap-2">
            {flagship && (
              <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-primary uppercase">
                {tf("flagship")}
              </span>
            )}
            {item.soon ? (
              <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gold uppercase">
                {common("soon")}
              </span>
            ) : (
              <ArrowUpRight className="size-5 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
            )}
          </div>
        </div>
        <h3 className={cn("font-semibold", flagship ? "text-xl" : "text-lg")}>{t(`${item.id}.title`)}</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">{t(`${item.id}.description`)}</p>
        {flagship && <FlagshipVisual id={item.id} />}
      </div>
    </>
  );
  const className = cn(
    "group relative block h-full overflow-hidden rounded-3xl p-6 transition-colors",
    flagship ? "glass border-primary/30" : "panel-solid",
    item.soon ? "opacity-75" : "hover:border-primary/40",
  );
  return (
    <div
      className={cn(
        "h-full transition-transform duration-300 motion-reduce:transition-none",
        !item.soon && "hover:-translate-y-1",
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
        title={t.rich("title", { em: (c) => <em className="italic font-medium text-foreground">{c}</em> })}
        text={t("text")}
      />
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {FLAGSHIP_ITEMS.map((item, i) => (
            <Reveal key={item.href} delay={i * 0.06} className="h-full">
              <SpotlightCard item={item} flagship />
            </Reveal>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOL_ITEMS.map((item, i) => (
            <Reveal key={item.href} delay={(i % 3) * 0.06} className="h-full">
              <SpotlightCard item={item} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
