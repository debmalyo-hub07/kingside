// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ChevronDown, ExternalLink, RotateCcw, Trash2, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import type * as React from "react";
import { useEffect, useId, useState } from "react";
import { BoardAppearanceFields } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { ReviewOptionFields } from "@/features/review/review-options";
import { getDb } from "@/lib/local-db";
import { formatSan } from "@/lib/notation";
import { DEPTH_OPTIONS, useSettings } from "@/lib/settings-store";
import { playSound, type SoundName } from "@/lib/sounds";
import { cn, safeHttpUrl } from "@/lib/utils";

function Section({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="glass scroll-mt-24 space-y-4 rounded-2xl p-5">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <SwitchField checked={checked} onCheckedChange={onChange} label={label} {...(hint ? { hint } : {})} />
  );
}

function Choice<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition hover:bg-accent",
              value === o.value && "border-primary bg-accent font-medium",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const TEST_SOUNDS: SoundName[] = [
  "move",
  "capture",
  "check",
  "castle",
  "promote",
  "gameEnd",
  "correct",
  "wrong",
];

const LICENSE_ENTRIES = [
  { id: "stockfish", url: "https://github.com/official-stockfish/Stockfish/tree/sf_19" },
  { id: "stockfishJs", url: "https://github.com/nmrugg/stockfish.js" },
  { id: "chessground", url: "https://github.com/lichess-org/chessground" },
  { id: "chessops", url: "https://github.com/niklasf/chessops" },
  { id: "lichess", url: "https://lichess.org/api" },
  { id: "pieces", url: "https://github.com/lichess-org/lila/tree/master/public/piece" },
] as const;

export function SettingsView() {
  const t = useTranslations("settings");
  const s = useSettings();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [counts, setCounts] = useState<{ evals: number; games: number } | null>(null);
  const [confirm, setConfirm] = useState<null | "evals" | "games" | "training" | "usernames" | "settings">(
    null,
  );
  const [done, setDone] = useState<string | null>(null);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const sourceUrl = safeHttpUrl(process.env.NEXT_PUBLIC_SOURCE_URL);
  const depthId = useId();
  const linesId = useId();
  const threadsId = useId();
  const hashId = useId();
  const langId = useId();
  const licensesPanelId = useId();

  useEffect(() => setMounted(true), []);
  const refreshCounts = async () => {
    const db = getDb();
    if (!db) return setCounts(null);
    try {
      setCounts({ evals: await db.evals.count(), games: await db.games.count() });
    } catch {
      setCounts(null);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount.
  useEffect(() => {
    void refreshCounts();
  }, []);

  const runConfirmed = async () => {
    const db = getDb();
    if (confirm === "evals") await db?.evals.clear().catch(() => undefined);
    if (confirm === "games") await db?.games.clear().catch(() => undefined);
    if (confirm === "training") {
      await db?.reviews.clear().catch(() => undefined);
      await db?.drills.clear().catch(() => undefined);
      await db?.practice.clear().catch(() => undefined);
    }
    if (confirm === "usernames") s.clearRememberedHandles();
    if (confirm === "settings") s.reset();
    setDone(t(`data.done.${confirm ?? "settings"}`));
    setConfirm(null);
    void refreshCounts();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-4xl">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Section id="s-look" title={t("look.title")}>
        {mounted && (
          <Choice
            label={t("look.theme")}
            value={(theme ?? "system") as "light" | "dark" | "system"}
            onChange={(v) => setTheme(v)}
            options={[
              { value: "dark", label: t("look.dark") },
              { value: "light", label: t("look.light") },
              { value: "system", label: t("look.system") },
            ]}
          />
        )}
        <BoardAppearanceFields />
      </Section>

      <Section id="s-sound" title={t("sound.title")}>
        <Toggle
          checked={s.soundEnabled}
          onChange={(v) => s.update({ soundEnabled: v })}
          label={t("sound.enabled")}
          hint={t("sound.hint")}
        />
        <label className="flex items-center gap-3 text-sm">
          <Volume2 className="size-4" aria-hidden />
          <span className="w-16">{t("sound.volume")}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.soundVolume * 100)}
            disabled={!s.soundEnabled}
            onChange={(e) => s.update({ soundVolume: Number(e.target.value) / 100 })}
            className="w-48 accent-primary"
            aria-valuetext={`${Math.round(s.soundVolume * 100)}%`}
          />
          <span className="w-10 font-mono text-xs tabular-nums">{Math.round(s.soundVolume * 100)}%</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {TEST_SOUNDS.map((name) => (
            <Button
              key={name}
              size="sm"
              variant="secondary"
              disabled={!s.soundEnabled}
              onClick={() => playSound(name)}
            >
              {t(`sound.names.${name}`)}
            </Button>
          ))}
        </div>
      </Section>

      <Section id="s-moves" title={t("moves.title")}>
        <Choice
          label={t("moves.notation")}
          value={s.notation}
          onChange={(v) => s.update({ notation: v })}
          options={[
            { value: "san", label: `${t("moves.san")} — Nf3 Bxe5` },
            {
              value: "figurine",
              label: `${t("moves.figurine")} — ${formatSan("Nf3", "figurine")} ${formatSan("Bxe5", "figurine")}`,
            },
          ]}
        />
        <Toggle
          checked={s.moveInput}
          onChange={(v) => s.update({ moveInput: v })}
          label={t("moves.input")}
          hint={t("moves.inputHint")}
        />
      </Section>

      <Section id="s-review" title={t("review.title")}>
        <ReviewOptionFields />
      </Section>

      <Section id="s-engine" title={t("engine.title")}>
        <Toggle
          checked={s.engineEnabled}
          onChange={(v) => s.update({ engineEnabled: v })}
          label={t("engine.enabled")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <label htmlFor={depthId} className="block font-medium">
              {t("engine.depth")}
            </label>
            <Select
              value={String(s.engineDepth ?? "inf")}
              onValueChange={(v) => s.update({ engineDepth: v === "inf" ? null : (Number(v) as never) })}
            >
              <SelectTrigger id={depthId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPTH_OPTIONS.map((d) => (
                  <SelectItem key={d ?? "inf"} value={String(d ?? "inf")}>
                    {d ?? "∞"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor={linesId} className="block font-medium">
              {t("engine.lines")}
            </label>
            <Select value={String(s.engineLines)} onValueChange={(v) => s.update({ engineLines: Number(v) })}>
              <SelectTrigger id={linesId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor={threadsId} className="block font-medium">
              {t("engine.threads")}
            </label>
            <Select
              value={String(s.engineThreads)}
              onValueChange={(v) => s.update({ engineThreads: Number(v) })}
            >
              <SelectTrigger id={threadsId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("engine.auto")}</SelectItem>
                {[1, 2, 4, 6, 8].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor={hashId} className="block font-medium">
              {t("engine.hash")}
            </label>
            <Select
              value={String(s.engineHashMb)}
              onValueChange={(v) => s.update({ engineHashMb: Number(v) })}
            >
              <SelectTrigger id={hashId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[16, 32, 64, 128, 256].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} MB
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Choice
          label={t("engine.net")}
          value={s.analysisNet}
          onChange={(v) => s.update({ analysisNet: v })}
          options={[
            { value: "lite", label: t("engine.netLite") },
            { value: "full", label: t("engine.netFull") },
          ]}
        />
        <Choice
          label={t("engine.explorer")}
          value={s.explorerDb}
          onChange={(v) => s.update({ explorerDb: v })}
          options={[
            { value: "masters", label: t("engine.masters") },
            { value: "lichess", label: t("engine.lichess") },
            { value: "book", label: t("engine.book") },
          ]}
        />
      </Section>

      <Section id="s-language" title={t("language.title")}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label htmlFor={langId}>{t("language.label")}</label>
          <Select value="en" disabled>
            <SelectTrigger id={langId} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{t("language.more")}</span>
        </div>
      </Section>

      <Section id="s-licenses" title={t("licenses.title")}>
        <p className="text-sm font-medium">{t("licenses.copyright")}</p>
        <p className="text-sm text-muted-foreground">{t("licenses.summary")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={licensesOpen}
            aria-controls={licensesPanelId}
            onClick={() => setLicensesOpen((open) => !open)}
          >
            {licensesOpen ? t("licenses.toggleHide") : t("licenses.toggleShow")}
            <ChevronDown
              className={cn("size-4 transition-transform", licensesOpen && "rotate-180")}
              aria-hidden
            />
          </Button>
          <Button type="button" variant="ghost" size="sm" asChild>
            <a href="/engine/COPYING.txt" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" aria-hidden />
              {t("licenses.engineCopy")}
            </a>
          </Button>
          {sourceUrl && (
            <Button type="button" variant="ghost" size="sm" asChild>
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" aria-hidden />
                {t("licenses.sourceCode")}
              </a>
            </Button>
          )}
        </div>
        {licensesOpen && (
          <ul id={licensesPanelId} className="divide-y rounded-xl border bg-secondary/30 text-sm">
            {LICENSE_ENTRIES.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {t(`licenses.items.${entry.id}.name`)}
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                  </a>
                  <p className="text-xs text-muted-foreground">{t(`licenses.items.${entry.id}.note`)}</p>
                </div>
                <span className="shrink-0 rounded-md border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {t(`licenses.items.${entry.id}.license`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="s-data" title={t("data.title")}>
        <p className="text-sm text-muted-foreground">{t("data.privacy")}</p>
        {counts && (
          <p className="text-sm">{t("data.counts", { games: counts.games, evals: counts.evals })}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirm("evals")}>
            <Trash2 /> {t("data.clearEvals")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("games")}>
            <Trash2 /> {t("data.clearGames")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("training")}>
            <Trash2 /> {t("data.clearTraining")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("usernames")}>
            <Trash2 /> {t("data.clearUsernames")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("settings")}>
            <RotateCcw /> {t("data.resetSettings")}
          </Button>
        </div>
        {confirm && (
          <div
            role="alertdialog"
            aria-label={t("data.confirmTitle")}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm"
          >
            <span className="text-destructive">{t(`data.confirm.${confirm}`)}</span>
            <Button
              size="sm"
              variant="default"
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={runConfirmed}
            >
              {t("data.yes")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              {t("data.cancel")}
            </Button>
          </div>
        )}
        {done && (
          <p role="status" className="text-sm text-primary">
            {done}
          </p>
        )}
      </Section>
    </div>
  );
}
