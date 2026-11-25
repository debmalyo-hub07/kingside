// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ArrowRight, CheckCircle2, History } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type Drill, listDrills, type PracticeResult, practiceResults } from "@/lib/local-db";
import { cn } from "@/lib/utils";
import { PRACTICE_SECTIONS } from "./positions";
import { goalText } from "./practice-session";

export function PracticeIndex() {
  const t = useTranslations("practice");
  const tp = useTranslations("practice.positions");
  const [results, setResults] = useState<Map<string, PracticeResult>>(new Map());
  const [drills, setDrills] = useState<Drill[] | null>(null);

  useEffect(() => {
    void practiceResults().then(setResults);
    void listDrills().then(setDrills);
  }, []);

  const total = PRACTICE_SECTIONS.reduce((a, s) => a + s.positions.length, 0);
  const solved = [...results.values()].filter((r) => r.solvedAt > 0).length;
  const due = drills?.filter((d) => d.due <= Date.now()).length ?? 0;

  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="font-display text-5xl tracking-tight">{t("title")}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("progress", { done: solved, total })}</p>
      </header>

      <section className="glass flex flex-col gap-4 rounded-3xl p-5 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
          <History className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{t("fromGames.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("fromGames.description")}</p>
          {drills && (
            <p className="mt-1 text-sm">
              {drills.length === 0
                ? t("fromGames.empty")
                : `${t("fromGames.due", { n: due })} · ${t("fromGames.total", { n: drills.length })}`}
            </p>
          )}
        </div>
        {drills && drills.length > 0 ? (
          <Button asChild disabled={due === 0}>
            <Link href="/practice/drills">
              {t("fromGames.start")} <ArrowRight />
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" asChild>
            <Link href="/review">{t("fromGames.reviewGame")}</Link>
          </Button>
        )}
      </section>

      {PRACTICE_SECTIONS.map((section) => {
        const done = section.positions.filter((p) => (results.get(p.id)?.solvedAt ?? 0) > 0).length;
        return (
          <section key={section.id} aria-labelledby={`sec-${section.id}`} className="space-y-3">
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <h2 id={`sec-${section.id}`} className="text-xl font-semibold">
                  {t(`sections.${section.id}.title`)}
                </h2>
                <p className="text-sm text-muted-foreground">{t(`sections.${section.id}.description`)}</p>
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">
                {done} / {section.positions.length}
              </span>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.positions.map((p) => {
                const ok = (results.get(p.id)?.solvedAt ?? 0) > 0;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/practice/${p.id}`}
                      className={cn(
                        "group flex h-full flex-col gap-1 rounded-2xl border bg-card p-4 transition hover:border-primary/50 hover:bg-accent",
                        ok && "border-primary/40",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{tp(`${p.id}.title`)}</span>
                        {ok ? (
                          <CheckCircle2
                            className="size-4 shrink-0 text-primary"
                            aria-label={t("session.solved")}
                          />
                        ) : (
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                        )}
                      </span>
                      <span className="text-sm text-primary">{goalText(p.goal, t)}</span>
                      <span className="text-xs text-muted-foreground">{t(`level.${p.level}`)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
