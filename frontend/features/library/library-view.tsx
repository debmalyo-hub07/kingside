// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { treeFromPgn } from "@kingside/chess-core";
import { Download, FileSearch, LineChart, Search, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAnalysis } from "@/features/analysis/analysis-store";
import { useReview } from "@/features/review/review-store";
import { downloadText } from "@/features/share/share-actions";
import { ShareDialog, type ShareTarget } from "@/features/share/share-dialog";
import { shareTargetFromPgn } from "@/features/share/share-target";
import { deleteGames, listGames, type SavedGame } from "@/lib/local-db";
import { cn } from "@/lib/utils";

type SourceFilter = "all" | SavedGame["source"];
type ResultFilter = "all" | "1-0" | "0-1" | "1/2-1/2";
const SOURCES: SourceFilter[] = ["all", "bot", "review", "analysis", "shared", "import"];
const RESULTS: ResultFilter[] = ["all", "1-0", "0-1", "1/2-1/2"];
const PAGE = 50;

function openingOf(game: SavedGame): string {
  if (game.opening) return game.opening;
  const m = /\[Opening "([^"]+)"\]/.exec(game.pgn);
  return m?.[1] ?? "";
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** This device's games (IndexedDB): search, filter, open, share, delete, export. */
export function LibraryView() {
  const t = useTranslations("library");
  const router = useRouter();
  const sourceId = useId();
  const resultId = useId();
  const [games, setGames] = useState<SavedGame[] | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [result, setResult] = useState<ResultFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => listGames().then(setGames);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount.
  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (games ?? []).filter(
      (g) =>
        (source === "all" || g.source === source) &&
        (result === "all" || g.result === result) &&
        (!q || `${g.white} ${g.black} ${openingOf(g)}`.toLowerCase().includes(q)),
    );
  }, [games, query, source, result]);
  const shown = filtered.slice(0, limit);
  const selectedGames = filtered.filter((g) => g.id !== undefined && selected.has(g.id));

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const open = (g: SavedGame, where: "analysis" | "review") => {
    setError(null);
    try {
      if (where === "analysis") {
        useAnalysis.getState().loadPgn(g.pgn);
        router.push("/analysis");
      } else {
        useReview.getState().start(g.pgn);
        router.push("/review");
      }
    } catch {
      setError(t("openFailed"));
    }
  };

  const exportPgn = (list: SavedGame[]) => {
    if (!list.length) return;
    downloadText(`${list.map((g) => g.pgn.trim()).join("\n\n")}\n`, `kingside-games-${list.length}.pgn`);
  };

  const remove = async () => {
    await deleteGames(selectedGames.flatMap((g) => (g.id === undefined ? [] : [g.id])));
    setSelected(new Set());
    setConfirmDelete(false);
    void reload();
  };

  const allShownSelected = shown.length > 0 && shown.every((g) => g.id !== undefined && selected.has(g.id));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-4xl">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportPgn(filtered)} disabled={!filtered.length}>
          <Download /> {t("exportAll", { n: filtered.length })}
        </Button>
      </header>

      <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">{t("search")}</span>
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-md border bg-background py-1.5 pr-2 pl-8 text-sm"
          />
        </label>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={sourceId} className="text-muted-foreground">
            {t("source")}
          </label>
          <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
            <SelectTrigger id={sourceId} size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`sources.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={resultId} className="text-muted-foreground">
            {t("result")}
          </label>
          <Select value={result} onValueChange={(v) => setResult(v as ResultFilter)}>
            <SelectTrigger id={resultId} size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESULTS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r === "all" ? t("sources.all") : r === "1/2-1/2" ? "½-½" : r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedGames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 text-sm">
          <span className="px-2">{t("selected", { n: selectedGames.length })}</span>
          <Button size="sm" variant="secondary" onClick={() => exportPgn(selectedGames)}>
            <Download /> {t("exportSelected")}
          </Button>
          {confirmDelete ? (
            <>
              <span className="text-destructive">{t("confirmDelete", { n: selectedGames.length })}</span>
              <Button
                size="sm"
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={remove}
              >
                {t("delete")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t("cancel")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> {t("delete")}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {games === null ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : games.length === 0 ? (
        <div className="glass space-y-3 rounded-2xl p-8 text-center">
          <p>{t("empty")}</p>
          <div className="flex flex-wrap justify-center gap-2 text-sm">
            <Link href="/play" className="text-primary hover:underline">
              {t("emptyPlay")}
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/review" className="text-primary hover:underline">
              {t("emptyReview")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    aria-label={t("selectAll")}
                    className="size-4 accent-primary"
                    checked={allShownSelected}
                    onChange={() =>
                      setSelected(
                        allShownSelected
                          ? new Set()
                          : new Set(shown.flatMap((g) => (g.id === undefined ? [] : [g.id]))),
                      )
                    }
                  />
                </th>
                <th className="p-3 font-medium">{t("players")}</th>
                <th className="hidden p-3 font-medium md:table-cell">{t("opening")}</th>
                <th className="p-3 font-medium">{t("result")}</th>
                <th className="hidden p-3 font-medium sm:table-cell">{t("date")}</th>
                <th className="p-3 text-right font-medium">
                  <span className="sr-only">{t("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <tr
                  key={g.id}
                  className={cn(
                    "border-b last:border-0",
                    g.id !== undefined && selected.has(g.id) && "bg-accent",
                  )}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label={t("select", { white: g.white, black: g.black })}
                      checked={g.id !== undefined && selected.has(g.id)}
                      onChange={() => g.id !== undefined && toggle(g.id)}
                    />
                  </td>
                  <td className="p-3">
                    <span className="font-medium">{g.white}</span>{" "}
                    <span className="text-muted-foreground">–</span>{" "}
                    <span className="font-medium">{g.black}</span>
                    <span className="ml-2 rounded-full bg-secondary px-2 py-px text-[10px] text-muted-foreground uppercase">
                      {t(`sources.${g.source}`)}
                    </span>
                  </td>
                  <td
                    className="hidden max-w-64 truncate p-3 text-muted-foreground md:table-cell"
                    title={openingOf(g)}
                  >
                    {openingOf(g)}
                  </td>
                  <td className="p-3 font-mono">{g.result === "1/2-1/2" ? "½-½" : g.result}</td>
                  <td className="hidden p-3 text-muted-foreground sm:table-cell">{fmtDate(g.playedAt)}</td>
                  <td className="p-1 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("analyze")}
                      title={t("analyze")}
                      onClick={() => open(g, "analysis")}
                    >
                      <LineChart />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("review")}
                      title={t("review")}
                      onClick={() => open(g, "review")}
                    >
                      <FileSearch />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("share")}
                      title={t("share")}
                      onClick={() => {
                        try {
                          treeFromPgn(g.pgn);
                          setShare(shareTargetFromPgn(g.pgn));
                        } catch {
                          setError(t("openFailed"));
                        }
                      }}
                    >
                      <Share2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
          )}
          {filtered.length > limit && (
            <div className="border-t p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                {t("showMore", { n: filtered.length - limit })}
              </Button>
            </div>
          )}
        </div>
      )}

      {share && <ShareDialog target={share} trigger={null} open onOpenChange={(v) => !v && setShare(null)} />}
    </div>
  );
}
