// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { mainlineFrom, treeFromPgn } from "@kingside/chess-core";
import { Download, FileSearch, LineChart, Search, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { useAnalysis } from "@/features/analysis/analysis-store";
import { useReview } from "@/features/review/review-store";
import { accuracyTone } from "@/features/review/review-summary";
import { downloadText } from "@/features/share/share-actions";
import { ShareDialog, type ShareTarget } from "@/features/share/share-dialog";
import { shareTargetFromPgn } from "@/features/share/share-target";
import { deleteGames, listGames, listReviews, type SavedGame, type SavedReview } from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import {
  buildReviewMap,
  extractOpeningBadge,
  filterLibraryGames,
  matchGameReview,
  type ResultFilter,
  type SourceFilter,
} from "./library-helpers";
import { MiniBoard } from "./mini-board";

const SOURCES: SourceFilter[] = ["all", "bot", "review", "analysis", "shared", "import"];
const RESULTS: ResultFilter[] = ["all", "1-0", "0-1", "1/2-1/2"];
const PAGE = 50;

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
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [result, setResult] = useState<ResultFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    Promise.all([listGames(), listReviews()]).then(([gs, rs]) => {
      setGames(gs);
      setReviews(rs);
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount.
  useEffect(() => {
    void reload();
  }, []);

  const reviewByHash = useMemo(() => buildReviewMap(reviews), [reviews]);

  const filtered = useMemo(
    () => filterLibraryGames(games ?? [], { query, source, result }, reviewByHash),
    [games, query, source, result, reviewByHash],
  );
  const shown = filtered.slice(0, limit);
  const selectedGames = filtered.filter((g) => g.id !== undefined && selected.has(g.id));

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const open = async (g: SavedGame, where: "analysis" | "review", matchedReview?: SavedReview) => {
    setError(null);
    try {
      if (where === "analysis") {
        const tree = treeFromPgn(g.pgn);
        const mainline = mainlineFrom(tree);
        const names = useSettings.getState().myNames.map((n) => n.toLowerCase());
        const orientation =
          matchedReview?.me ??
          (g.source === "bot" && g.black === "You" && g.white !== "You"
            ? "black"
            : names.includes(g.white.toLowerCase())
              ? "white"
              : names.includes(g.black.toLowerCase())
                ? "black"
                : "white");
        useAnalysis.getState().loadPgn(g.pgn, {
          ply: mainline.length,
          orientation,
          ...(matchedReview?.classes?.length ? { classes: matchedReview.classes } : {}),
          ...(matchedReview?.whiteWin?.length ? { whiteWin: matchedReview.whiteWin } : {}),
        });
        router.push("/analysis");
      } else {
        await useReview
          .getState()
          .openSavedOrStart(g.pgn, matchedReview, matchedReview?.me ? { me: matchedReview.me } : undefined);
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
        <TooltipProvider delayDuration={250}>
          <div className="glass overflow-x-auto rounded-2xl">
            <table className="w-full table-fixed text-sm sm:table-auto">
              <caption className="sr-only">{t("tableCaption")}</caption>
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 p-1.5 sm:w-10 sm:p-3">
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
                  <th className="p-1.5 font-medium sm:p-3">{t("players")}</th>
                  <th className="hidden p-3 font-medium md:table-cell">{t("opening")}</th>
                  <th className="hidden p-3 font-medium lg:table-cell">{t("accuracy")}</th>
                  <th className="hidden p-3 font-medium sm:table-cell">{t("result")}</th>
                  <th className="hidden p-3 font-medium sm:table-cell">{t("date")}</th>
                  <th className="w-[6.5rem] p-1 text-right font-medium sm:w-auto sm:p-3">
                    <span className="sr-only">{t("actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const matchedReview = matchGameReview(g, reviewByHash);
                  const opening = extractOpeningBadge(g, matchedReview);
                  const wAcc = matchedReview?.accuracy.white ?? null;
                  const bAcc = matchedReview?.accuracy.black ?? null;
                  const hasAccuracy = wAcc !== null || bAcc !== null;

                  return (
                    <tr
                      key={g.id}
                      className={cn(
                        "border-b transition-colors last:border-0 hover:bg-secondary/30",
                        g.id !== undefined && selected.has(g.id) && "bg-accent",
                      )}
                    >
                      <td className="p-1.5 sm:p-3">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={t("select", { white: g.white, black: g.black })}
                          checked={g.id !== undefined && selected.has(g.id)}
                          onChange={() => g.id !== undefined && toggle(g.id)}
                        />
                      </td>
                      <td className="p-1.5 sm:p-3">
                        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                          <MiniBoard
                            pgn={g.pgn}
                            label={t("preview", { white: g.white, black: g.black })}
                            className="size-10 shrink-0 border border-border/70 shadow-xs sm:size-12"
                          />
                          <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span className="max-w-full truncate font-medium">{g.white}</span>
                              <span className="text-muted-foreground">–</span>
                              <span className="max-w-full truncate font-medium">{g.black}</span>
                              <span className="rounded-full bg-secondary px-2 py-px text-[10px] text-muted-foreground uppercase">
                                {t(`sources.${g.source}`)}
                              </span>
                              <span className="rounded bg-secondary/70 px-1.5 py-px font-mono text-[10px] text-foreground sm:hidden">
                                {g.result === "1/2-1/2" ? "½-½" : g.result}
                              </span>
                            </div>
                            {(opening || hasAccuracy) && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] lg:hidden">
                                {opening && (
                                  <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border bg-secondary/60 px-2 py-px md:hidden">
                                    {opening.eco && (
                                      <span className="font-mono font-semibold text-primary">
                                        {opening.eco}
                                      </span>
                                    )}
                                    {opening.name && (
                                      <span className="truncate text-muted-foreground">{opening.name}</span>
                                    )}
                                  </span>
                                )}
                                {hasAccuracy && (
                                  <span className="inline-flex items-center gap-1.5 font-mono">
                                    {wAcc !== null && (
                                      <span className={cn("font-semibold", accuracyTone(wAcc))}>
                                        {t("whiteAbbr")} {wAcc.toFixed(1)}%
                                      </span>
                                    )}
                                    {wAcc !== null && bAcc !== null && (
                                      <span className="text-muted-foreground">/</span>
                                    )}
                                    {bAcc !== null && (
                                      <span className={cn("font-semibold", accuracyTone(bAcc))}>
                                        {t("blackAbbr")} {bAcc.toFixed(1)}%
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden max-w-64 p-3 md:table-cell">
                        {opening ? (
                          <span
                            title={[opening.eco, opening.name].filter(Boolean).join(" · ")}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-secondary/60 px-2.5 py-0.5 text-xs"
                          >
                            {opening.eco && (
                              <span className="shrink-0 font-mono font-semibold text-primary">
                                {opening.eco}
                              </span>
                            )}
                            {opening.name && (
                              <span className="truncate text-muted-foreground">{opening.name}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden p-3 whitespace-nowrap lg:table-cell">
                        {hasAccuracy ? (
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs">
                            {wAcc !== null && (
                              <span
                                title={t("whiteAccuracy", { pct: wAcc.toFixed(1) })}
                                className="inline-flex items-center gap-1 rounded-md border bg-secondary/40 px-1.5 py-0.5"
                              >
                                <span
                                  aria-hidden
                                  className="size-2 rounded-full border border-border bg-[var(--eval-white-bg)]"
                                />
                                <span className="sr-only">
                                  {t("whiteAccuracy", { pct: wAcc.toFixed(1) })}
                                </span>
                                <span aria-hidden className={cn("font-semibold", accuracyTone(wAcc))}>
                                  {t("whiteAbbr")} {wAcc.toFixed(1)}%
                                </span>
                              </span>
                            )}
                            {bAcc !== null && (
                              <span
                                title={t("blackAccuracy", { pct: bAcc.toFixed(1) })}
                                className="inline-flex items-center gap-1 rounded-md border bg-secondary/40 px-1.5 py-0.5"
                              >
                                <span
                                  aria-hidden
                                  className="size-2 rounded-full border border-border bg-[var(--eval-black-bg)]"
                                />
                                <span className="sr-only">
                                  {t("blackAccuracy", { pct: bAcc.toFixed(1) })}
                                </span>
                                <span aria-hidden className={cn("font-semibold", accuracyTone(bAcc))}>
                                  {t("blackAbbr")} {bAcc.toFixed(1)}%
                                </span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden p-3 font-mono whitespace-nowrap sm:table-cell">
                        {g.result === "1/2-1/2" ? "½-½" : g.result}
                      </td>
                      <td className="hidden p-3 text-muted-foreground whitespace-nowrap sm:table-cell">
                        {fmtDate(g.playedAt)}
                      </td>
                      <td className="p-1 text-right whitespace-nowrap sm:p-2">
                        <HintTooltip label={t("analyze")} description={t("analyzeHint")}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 sm:size-9"
                            aria-label={t("analyze")}
                            onClick={() => void open(g, "analysis", matchedReview)}
                          >
                            <LineChart />
                          </Button>
                        </HintTooltip>
                        <HintTooltip label={t("review")} description={t("reviewHint")}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 sm:size-9"
                            aria-label={t("review")}
                            onClick={() => void open(g, "review", matchedReview)}
                          >
                            <FileSearch />
                          </Button>
                        </HintTooltip>
                        <HintTooltip label={t("share")} description={t("shareHint")}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 sm:size-9"
                            aria-label={t("share")}
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
                        </HintTooltip>
                      </td>
                    </tr>
                  );
                })}
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
        </TooltipProvider>
      )}

      {share && <ShareDialog target={share} trigger={null} open onOpenChange={(v) => !v && setShare(null)} />}
    </div>
  );
}
