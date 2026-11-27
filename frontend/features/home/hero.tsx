// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Cpu, FileSearch, LayoutGrid, Lock, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { listReviews, type SavedReview } from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { HeroBoard } from "./hero-board";
import { QuickStart } from "./quick-start";

const BADGES = [
  { icon: Sparkles, key: "free" },
  { icon: Cpu, key: "engine" },
  { icon: Lock, key: "noAccount" },
] as const;

function HeroResumeBar() {
  const t = useTranslations("home.hero");
  const myNames = useSettings((s) => s.myNames);
  const [latestReview, setLatestReview] = useState<SavedReview | null>(null);

  useEffect(() => {
    let active = true;
    void listReviews().then((rows) => {
      if (!active) return;
      const withPgn = rows.find((r) => Boolean(r.pgn));
      if (withPgn) setLatestReview(withPgn);
    });
    return () => {
      active = false;
    };
  }, []);

  if (myNames.length === 0 && !latestReview) return null;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-1 text-xs">
      {latestReview && (
        <Link
          href={`/review?game=${encodeURIComponent(latestReview.gameHash)}`}
          className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 font-medium text-primary transition hover:bg-primary/20"
        >
          <FileSearch className="size-3" aria-hidden />
          <span className="max-w-52 truncate">
            {t("resumeReview", { white: latestReview.white, black: latestReview.black })}
          </span>
        </Link>
      )}
      {myNames.slice(0, 2).map((name) => (
        <Link
          key={name}
          href={`/review?site=lichess&user=${encodeURIComponent(name)}`}
          className="inline-flex min-h-6 items-center gap-1 rounded-full border border-border bg-secondary/70 px-2.5 py-0.5 font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <UserRound className="size-3 text-primary" aria-hidden />
          <span>{t("recentPlayer", { name })}</span>
        </Link>
      ))}
    </div>
  );
}

export function Hero() {
  const t = useTranslations("home.hero");
  // Pure CSS entrance (no JavaScript needed). Text slides but is never invisible: the headline is
  // the page's LCP element.
  const item = (i: number) => ({
    className:
      "animate-in slide-in-from-bottom-4 fill-mode-both duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none",
    style: { animationDelay: `${80 * i}ms` },
  });
  const cls = (i: number, extra: string) => `${item(i).className} ${extra}`;

  return (
    <section className="grid items-center gap-10 py-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:py-12 [&>*]:min-w-0">
      <div>
        <p
          className={cls(
            0,
            "mb-5 inline-flex items-center gap-2 rounded-full border bg-secondary/60 px-3 py-1 text-xs font-medium text-muted-foreground",
          )}
          style={item(0).style}
        >
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          {t("live")}
        </p>
        <h1
          className={cls(1, "font-display text-5xl leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl")}
          style={item(1).style}
        >
          {t("title1")}
          <br />
          <em className="text-gradient">{t("title2")}</em>
        </h1>
        <p className={cls(2, "mt-6 max-w-xl text-lg text-muted-foreground")} style={item(2).style}>
          {t("subtitle")}
        </p>
        <div className={cls(3, "mt-8 max-w-xl")} style={item(3).style}>
          <QuickStart />
          <HeroResumeBar />
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-sm text-muted-foreground">
            <Link href="/editor" className="inline-flex items-center gap-1 hover:text-primary">
              <LayoutGrid className="size-3.5" /> {t("setup")}
            </Link>
          </p>
        </div>
        <ul
          className={cls(4, "mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground")}
          style={item(4).style}
        >
          {BADGES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-center gap-2">
              <Icon className="size-4 text-primary" aria-hidden />
              {t(`badges.${key}`)}
            </li>
          ))}
        </ul>
      </div>

      {/* No scale/rotate here: chessground measures the board once and would keep a shrunken size. */}
      <div
        className="mx-auto w-full max-w-[34rem] animate-in fade-in slide-in-from-bottom-6 fill-mode-both duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none"
        style={{ animationDelay: "150ms" }}
      >
        <HeroBoard />
      </div>
    </section>
  );
}
