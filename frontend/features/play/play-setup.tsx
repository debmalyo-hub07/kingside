// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { BOTS } from "@kingside/chess-core";
import { Shuffle, Swords } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { listGames, type SavedGame } from "@/lib/local-db";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import { TIME_CONTROLS, usePlay } from "./play-store";

const BOT_TIERS = [
  { key: "casual", ids: ["pip", "rosa", "milo"] },
  { key: "club", ids: ["tara", "kenji", "amara"] },
  { key: "master", ids: ["viktor", "selene"] },
  { key: "grandmaster", ids: ["atlas", "max"] },
] as const;

type BotRecord = { w: number; d: number; l: number };

export function PlaySetup() {
  const t = useTranslations("play");
  const { botId, tc, initialFen, setBot, setTimeControl, setInitialFen, start } = usePlay();
  const [botGames, setBotGames] = useState<SavedGame[]>([]);
  const selected = BOTS.find((b) => b.id === botId) ?? BOTS[0];

  useEffect(() => {
    let active = true;
    void listGames().then((all) => {
      if (active) setBotGames(all.filter((g) => g.source === "bot" && Boolean(g.botId)));
    });
    return () => {
      active = false;
    };
  }, []);

  const records = useMemo(() => {
    const map: Record<string, BotRecord> = {};
    for (const g of botGames) {
      if (!g.botId) continue;
      const botPersona = BOTS.find((b) => b.id === g.botId);
      if (!botPersona) continue;
      const rec = map[g.botId] ?? { w: 0, d: 0, l: 0 };
      map[g.botId] = rec;
      if (g.result === "1/2-1/2") {
        rec.d += 1;
      } else if (g.result === "1-0" || g.result === "0-1") {
        const botWhite = g.white === botPersona.name;
        const playerWon = (g.result === "1-0") === !botWhite;
        if (playerWon) rec.w += 1;
        else rec.l += 1;
      }
    }
    return map;
  }, [botGames]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto max-md:pb-6">
      <div className="text-center">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{t("setup.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t("setup.subtitle")}</p>
        {initialFen && (
          <div className="mt-2.5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs">
            <span className="font-medium text-primary">{t("setup.customFen")}</span>
            <button
              type="button"
              onClick={() => setInitialFen(null)}
              className="text-muted-foreground underline hover:text-foreground"
            >
              {t("setup.clearFen")}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {BOT_TIERS.map((tier) => {
          const tierBots = BOTS.filter((b) => (tier.ids as readonly string[]).includes(b.id));
          return (
            <section key={tier.key} className="space-y-2">
              <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {t(`tiers.${tier.key}`)}
              </h2>
              <ul className={cn("grid gap-2.5 sm:grid-cols-2", tierBots.length === 3 && "sm:grid-cols-3")}>
                {tierBots.map((bot) => {
                  const rec = records[bot.id];
                  return (
                    <li key={bot.id}>
                      <button
                        type="button"
                        onClick={() => setBot(bot.id)}
                        aria-pressed={bot.id === botId}
                        className={cn(
                          "panel-solid flex h-full w-full items-center gap-2.5 rounded-2xl p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/50",
                          bot.id === botId && "border-primary ring-2 ring-primary/40",
                        )}
                      >
                        <BotAvatar bot={bot} className="size-11 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="truncate font-semibold">{bot.name}</span>
                            <span className="surface-well shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
                              {bot.level.method === "max" ? t("setup.max") : `~${bot.level.elo}`}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                            {t.has(`bots.${bot.id}` as never) ? t(`bots.${bot.id}` as never) : bot.tagline}
                          </p>
                          {rec && (
                            <p className="mt-0.5 font-mono text-[10px] text-primary tabular-nums">
                              {t("recordBadge", { w: rec.w, d: rec.d, l: rec.l })}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {selected && (
        <div className="glass mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-3xl p-6 sm:flex-row">
          <BotAvatar bot={selected} className="size-20" />
          <div className="flex-1 space-y-4 text-center sm:text-left">
            <div>
              <p className="text-xl font-semibold">{selected.name}</p>
              <p className="text-sm text-muted-foreground">
                {t.has(`bots.${selected.id}` as never) ? t(`bots.${selected.id}` as never) : selected.tagline}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              {TIME_CONTROLS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTimeControl(c)}
                  aria-pressed={tc.id === c.id}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition",
                    tc.id === c.id
                      ? "border-primary bg-primary/15"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.id === "none" ? t("setup.noClock") : c.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button onClick={() => start("white")}>
                <span className="size-3 rounded-full border border-border bg-[var(--eval-white-bg)]" />{" "}
                {t("setup.playWhite")}
              </Button>
              <Button variant="secondary" onClick={() => start("random")}>
                <Shuffle /> {t("setup.random")}
              </Button>
              <Button variant="secondary" onClick={() => start("black")}>
                <span className="size-3 rounded-full border border-border bg-[var(--eval-black-bg)]" />{" "}
                {t("setup.playBlack")}
              </Button>
            </div>
          </div>
          <Swords className="hidden size-10 text-muted-foreground/40 sm:block" aria-hidden />
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">{t("setup.note")}</p>
    </div>
  );
}
