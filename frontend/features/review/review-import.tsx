// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ArrowRight, ClipboardPaste, Loader2, Search, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiGet, type ImportedGame } from "@/lib/api";
import { useSettings } from "@/lib/settings-store";
import { useApiErrorText } from "@/lib/use-api-error";
import { usePositionErrorText } from "@/lib/use-position-error";
import { cn } from "@/lib/utils";
import { formatNodes } from "./review-progress";
import { DEPTH_PRESETS, type ImportSite, useReview } from "./review-store";

const TABS: ImportSite[] = ["lichess", "chesscom", "pgn"];

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
            <span
              aria-hidden
              className="mr-1 inline-block size-2.5 rounded-full border border-border bg-[var(--eval-white-bg)] align-middle"
            />
            {game.white.name} <span className="text-muted-foreground">({game.white.rating ?? "?"})</span>
            <span className="mx-2 text-muted-foreground">{t("vs")}</span>
            <span
              aria-hidden
              className="mr-1 inline-block size-2.5 rounded-full border border-border bg-[var(--eval-black-bg)] align-middle"
            />
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
  const recentHandles = useSettings((s) => s.recentHandles);
  const rememberHandle = useSettings((s) => s.rememberHandle);
  const removeHandle = useSettings((s) => s.removeHandle);
  const clearRememberedHandles = useSettings((s) => s.clearRememberedHandles);
  const {
    preset,
    setPreset,
    start,
    error: storeError,
    importSite: tab,
    importUser: username,
    importSearched: searched,
    fetchedGames: games,
    pendingLookup,
    consumePendingLookup,
    setImportState,
  } = useReview();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pgn, setPgn] = useState("");
  const prefilledRef = useRef(false);

  const search = useCallback(
    async (e?: React.FormEvent, source: ImportSite = tab, typed: string = username) => {
      e?.preventDefault();
      if (source === "pgn") return;
      const name = typed.trim();
      if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) {
        setError(t("badUsername"));
        return;
      }
      setLoading(true);
      setError(null);
      setImportState({ importSite: source, importUser: name, fetchedGames: null });
      try {
        const { games: loaded } = await apiGet<{ games: ImportedGame[] }>(
          `/api/import/${source}/${encodeURIComponent(name)}?max=25`,
        );
        setImportState({ importSite: source, importUser: name, importSearched: name, fetchedGames: loaded });
        // Remember `{ site, name }`: its side of every game is "you" in insights and drills.
        rememberHandle(source, name);
      } catch (err) {
        setError(apiError(err));
      } finally {
        setLoading(false);
      }
    },
    [tab, username, t, apiError, setImportState, rememberHandle],
  );

  // Execute pending lookup requested via /review?site=...&user=...
  useEffect(() => {
    if (!pendingLookup) return;
    const req = consumePendingLookup();
    if (req) void search(undefined, req.site, req.user);
  }, [pendingLookup, consumePendingLookup, search]);

  // Pre-fill the most recent remembered handle for this site when opening /review fresh without a typed handle.
  useEffect(() => {
    if (prefilledRef.current) return;
    if (pendingLookup || username || tab === "pgn") return;
    const match = recentHandles.find((h) => h.site === tab);
    if (match) {
      prefilledRef.current = true;
      setImportState({ importUser: match.name });
    }
  }, [pendingLookup, username, recentHandles, tab, setImportState]);

  const begin = (text: string, meta?: Parameters<typeof start>[1]) => {
    try {
      start(text, meta);
      setError(null);
    } catch (err) {
      setError(positionError(err));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto max-md:pb-6">
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
                setImportState({ importSite: id, fetchedGames: null, importSearched: "" });
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
              onChange={(e) => {
                prefilledRef.current = true;
                setImportState({ importUser: e.target.value });
              }}
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

        {tab !== "pgn" && recentHandles.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{t("recentUsernames")}</span>
            {recentHandles.map((h) => {
              const active = tab === h.site && username.trim().toLowerCase() === h.name.toLowerCase();
              const siteLabel = t(`tabs.${h.site}`);
              return (
                <div
                  key={`${h.site}:${h.name.toLowerCase()}`}
                  className={cn(
                    "inline-flex items-center overflow-hidden rounded-full border transition",
                    active
                      ? "border-primary bg-primary/15 text-foreground"
                      : "bg-secondary/60 text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      prefilledRef.current = true;
                      setImportState({ importSite: h.site, importUser: h.name });
                      void search(undefined, h.site, h.name);
                    }}
                    aria-label={t("useUsername", { name: h.name, site: siteLabel })}
                    aria-pressed={active}
                    className="inline-flex items-center gap-1.5 py-1 pr-1.5 pl-2.5 font-medium"
                  >
                    <span>{h.name}</span>
                    <span className="rounded bg-background/70 px-1 py-px text-[10px] font-normal text-muted-foreground">
                      {siteLabel}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHandle(h.site, h.name)}
                    aria-label={t("removeUsername", { name: h.name })}
                    className="grid size-6 place-items-center text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={clearRememberedHandles}
              className="ml-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
            >
              {t("clearUsernames")}
            </button>
          </div>
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
