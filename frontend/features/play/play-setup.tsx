// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { BOTS } from "@kingside/chess-core";
import { Shuffle, Swords } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import { TIME_CONTROLS, usePlay } from "./play-store";

export function PlaySetup() {
  const t = useTranslations("play");
  const { botId, tc, setBot, setTimeControl, start } = usePlay();
  const selected = BOTS.find((b) => b.id === botId) ?? BOTS[0];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="text-center">
        <h1 className="font-display text-5xl tracking-tight">{t("setup.title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("setup.subtitle")}</p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BOTS.map((bot) => (
          <li key={bot.id}>
            <button
              type="button"
              onClick={() => setBot(bot.id)}
              aria-pressed={bot.id === botId}
              className={cn(
                "glass flex h-full w-full flex-col items-center gap-2 rounded-2xl p-4 text-center transition hover:-translate-y-0.5 hover:border-primary/50",
                bot.id === botId && "border-primary ring-2 ring-primary/40",
              )}
            >
              <BotAvatar bot={bot} className="size-14" />
              <span className="font-semibold">{bot.name}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-xs">
                {bot.level.method === "max" ? t("setup.max") : `~${bot.level.elo}`}
              </span>
            </button>
          </li>
        ))}
      </ul>

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
                <span className="size-3 rounded-full border border-neutral-400 bg-white" />{" "}
                {t("setup.playWhite")}
              </Button>
              <Button variant="secondary" onClick={() => start("random")}>
                <Shuffle /> {t("setup.random")}
              </Button>
              <Button variant="secondary" onClick={() => start("black")}>
                <span className="size-3 rounded-full border border-neutral-500 bg-neutral-900" />{" "}
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
