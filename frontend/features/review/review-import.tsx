// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ArrowRight, ClipboardPaste, Loader2, Search, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiGet, type ImportedGame } from "@/lib/api";
import { useSettings } from "@/lib/settings-store";
import { useApiErrorText } from "@/lib/use-api-error";
import { usePositionErrorText } from "@/lib/use-position-error";
import { cn } from "@/lib/utils";
import { formatNodes } from "./review-progress";
import { DEPTH_PRESETS, useReview } from "./review-store";

type Tab = "lichess" | "chesscom" | "pgn";

const TABS: Tab[] = ["lichess", "chesscom", "pgn"];

type Outcome = "draw" | "unfinished" | "won" | "lost";

function resultFor(game: ImportedGame, name: string): { key: Outcome; tone: string } {
  const isWhite = game.white.name.toLowerCase() === name.toLowerCase();
  if (game.result === "1/2-1/2") return { key: "draw", tone: "text-muted-foreground" };
  if (game.result === "*") return { key: "unfinished", tone: "text-muted-foreground" };
  const won = (game.result === "1-0") === isWhite;
  return won ? { key: "won", tone: "text-primary" } : { key: "lost", tone: "text-destructive" };
}

function GameRow({ game, username, onPick }: { game: ImportedGame; username: string; onPick: () => void }) {
  const t = useTranslations("review.import");
  const result = resultFor(game, username);
  const date = new Date(game.playedAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="group flex w-full items-center gap-4 rounded-2xl border bg-card px-4 py-3 text-left transition hover:border-primary/50 hover:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            <span className="mr-1 inline-block size-2.5 rounded-full border border-neutral-400 bg-white align-middle" />
            {game.white.name} <span className="text-muted-foreground">({game.white.rating ?? "?"})</span>
            <span className="mx-2 text-muted-foreground">{t("vs")}</span>
            <span className="mr-1 inline-block size-2.5 rounded-full border border-neutral-500 bg-neutral-900 align-middle" />
            {game.black.name} <span className="text-muted-foreground">({game.black.rating ?? "?"})</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {game.timeClass} · {date}
            {game.opening ? ` · ${game.opening}` : ""}
          </p>
        </div>
        <span className={cn("text-sm font-semibold", result.tone)}>{t(`outcome.${result.key}`)}</span>
        <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </button>
    </li>
  );
}

export function ReviewImport() {
  const t = useTranslations("review.import");
  const tr = useTranslations("review");
  const apiError = useApiErrorText();
  const positionError = usePositionErrorText();
  const { preset, setPreset, start, error: storeError } = useReview();
  const [tab, setTab] = useState<Tab>("lichess");
  const [username, setUsername] = useState("");
  const [searched, setSearched] = useState("");
  const [games, setGames] = useState<ImportedGame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pgn, setPgn] = useState("");

  const search = async (e?: React.FormEvent, source: Tab = tab, typed: string = username) => {
    e?.preventDefault();
    const name = typed.trim();
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) {
      setError(t("badUsername"));
      return;
    }
    setLoading(true);
    setError(null);
    setGames(null);
    try {
      const { games } = await apiGet<{ games: ImportedGame[] }>(
        `/api/import/${source}/${encodeURIComponent(name)}?max=25`,
      );
      setGames(games);
      setSearched(name);
      // Remember the name: its side of every game is "you" in insights and drills.
      const known = useSettings.getState().myNames;
      if (!known.some((n) => n.toLowerCase() === name.toLowerCase())) {
        useSettings.getState().update({ myNames: [name, ...known].slice(0, 5) });
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  // Arriving from the home page quick start: /review?site=chesscom&user=name searches right away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on arrival
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const site = params.get("site");
    const user = params.get("user");
    if ((site === "lichess" || site === "chesscom") && user) {
      setTab(site);
      setUsername(user);
      void search(undefined, site, user);
    }
  }, []);

  const begin = (text: string, meta?: Parameters<typeof start>[1]) => {
    try {
      start(text, meta);
      setError(null);
    } catch (err) {
      setError(positionError(err));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="text-center">
        <h1 className="font-display text-5xl tracking-tight">{t("title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="glass rounded-3xl p-4 sm:p-6">
        <div role="tablist" aria-label={t("source")} className="mb-5 flex gap-1 rounded-xl bg-secondary p-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setGames(null);
                setError(null);
              }}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition",
                tab === id ? "bg-background shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>

        {tab === "pgn" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pgn.trim().length > 1_000_000) setError(t("pgnTooLarge"));
              else if (pgn.trim()) begin(pgn);
            }}
            className="space-y-3"
          >
            <textarea
              value={pgn}
              onChange={(e) => setPgn(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'[White "..."]\n[Black "..."]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
              className="w-full resize-y rounded-xl border bg-background p-3 font-mono text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm transition hover:border-primary/50 focus-within:ring-2 focus-within:ring-ring">
                <Upload className="size-4" /> {t("openFile")}
                <input
                  type="file"
                  accept=".pgn,.txt,application/x-chess-pgn,text/plain"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (file.size > 1_000_000) {
                      setError(t("fileTooLarge"));
                      return;
                    }
                    setPgn(await file.text());
                    setError(null);
                  }}
                />
              </label>
              <Button type="submit" className="flex-1" disabled={!pgn.trim()}>
                <ClipboardPaste /> {t("reviewThis")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("firstGame")}</p>
          </form>
        ) : (
          <form onSubmit={search} className="flex gap-2">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t(tab === "lichess" ? "usernameLichess" : "usernameChesscom")}
              aria-label={t("username")}
              autoComplete="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-4 text-sm"
            />
            <Button type="submit" className="h-11 px-5" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Search />} {t("find")}
            </Button>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("depth")}</span>
          {DEPTH_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              aria-pressed={preset === p.id}
              className={cn(
                "rounded-lg border px-3 py-1 transition",
                preset === p.id
                  ? "border-primary bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tr(`presets.${p.id}`)}{" "}
              <span className="text-xs text-muted-foreground">({formatNodes(p.nodes)})</span>
            </button>
          ))}
        </div>

        {(error ?? storeError) && (
          <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error ?? (storeError ? tr(`errors.${storeError}`) : null)}
          </p>
        )}
      </div>

      {games && (
        <section aria-label={t("recent")} className="space-y-2">
          <p className="px-1 text-sm text-muted-foreground">
            {games.length ? t("recentOf", { name: searched }) : t("noneFound", { name: searched })}
          </p>
          <ul className="space-y-2">
            {games.map((g) => (
              <GameRow
                key={g.id}
                game={g}
                username={searched}
                onPick={() =>
                  begin(g.pgn, {
                    white: g.white,
                    black: g.black,
                    result: g.result,
                    url: g.url,
                    timeClass: g.timeClass,
                    date: new Date(g.playedAt).toISOString().slice(0, 10),
                    me:
                      g.white.name.toLowerCase() === searched.toLowerCase()
                        ? "white"
                        : g.black.name.toLowerCase() === searched.toLowerCase()
                          ? "black"
                          : null,
                  })
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
