// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { BookOpen, ExternalLink, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { colorOfPly, formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { type ExplorerMove, type ExplorerResult, useBookMoves, useExplorer } from "./explorer-data";

const SOURCES = ["masters", "lichess", "book"] as const;
type Source = (typeof SOURCES)[number];

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString("en");
}

function ResultBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  const parts = [
    { n: white, cls: "bg-neutral-100 text-neutral-900" },
    { n: draws, cls: "bg-neutral-400 text-neutral-900" },
    { n: black, cls: "bg-neutral-800 text-neutral-100" },
  ];
  return (
    <span
      className="flex h-5 w-full overflow-hidden rounded text-[10px] leading-5 font-semibold"
      role="img"
      aria-label={`White ${pct(white)}%, draw ${pct(draws)}%, Black ${pct(black)}%`}
    >
      {parts.map((p, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed three segments.
          key={i}
          className={cn("overflow-hidden text-center", p.cls)}
          style={{ width: `${(p.n / total) * 100}%` }}
        >
          {p.n / total >= 0.12 ? `${pct(p.n)}%` : ""}
        </span>
      ))}
    </span>
  );
}

function StatsTable({
  result,
  ply,
  onPlay,
}: {
  result: ExplorerResult;
  ply: number;
  onPlay: (uci: string) => void;
}) {
  const t = useTranslations("explorer");
  const notation = useSettings((s) => s.notation);
  const color = colorOfPly(ply + 1);
  const totalGames = result.total.white + result.total.draws + result.total.black;
  if (result.moves.length === 0)
    return <p className="px-3 py-2 text-sm text-muted-foreground">{t("noGames")}</p>;
  const row = (m: ExplorerMove) => {
    const games = m.white + m.draws + m.black;
    return (
      <tr key={m.uci} className="hover:bg-accent">
        <td className="py-1 pr-2 pl-3">
          <button type="button" className="font-mono text-sm font-semibold" onClick={() => onPlay(m.uci)}>
            {formatSan(m.san, notation, color)}
          </button>
        </td>
        <td className="px-1 text-right font-mono text-xs text-muted-foreground tabular-nums">
          {totalGames ? `${Math.round((games / totalGames) * 100)}%` : ""}
        </td>
        <td className="px-1 text-right font-mono text-xs tabular-nums">{compact(games)}</td>
        <td className="w-1/2 py-1 pr-3 pl-1">
          <ResultBar white={m.white} draws={m.draws} black={m.black} />
        </td>
      </tr>
    );
  };
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1 pr-2 pl-3 font-medium">{t("move")}</th>
          <th className="px-1 text-right font-medium" aria-label={t("share")} />
          <th className="px-1 text-right font-medium">{t("games")}</th>
          <th className="py-1 pr-3 pl-1 font-medium">{t("results")}</th>
        </tr>
      </thead>
      <tbody>
        {result.moves.map(row)}
        <tr className="border-t">
          <td className="py-1 pr-2 pl-3 text-xs text-muted-foreground">Σ</td>
          <td />
          <td className="px-1 text-right font-mono text-xs tabular-nums">{compact(totalGames)}</td>
          <td className="w-1/2 py-1 pr-3 pl-1">
            <ResultBar {...result.total} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function BookList({ fen, ply, onPlay }: { fen: string; ply: number; onPlay: (uci: string) => void }) {
  const t = useTranslations("explorer");
  const notation = useSettings((s) => s.notation);
  const book = useBookMoves(fen, true);
  if (book.status === "loading" || book.status === "idle") return <Spinner />;
  if (book.status === "error" || book.data.length === 0)
    return <p className="px-3 py-2 text-sm text-muted-foreground">{t("outOfBook")}</p>;
  return (
    <ul className="pb-1">
      {book.data.map((m) => (
        <li key={m.uci}>
          <button
            type="button"
            onClick={() => onPlay(m.uci)}
            className="flex w-full items-baseline gap-3 px-3 py-1 text-left hover:bg-accent"
          >
            <span className="w-14 shrink-0 font-mono text-sm font-semibold">
              {formatSan(m.san, notation, colorOfPly(ply + 1))}
            </span>
            {m.name ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={m.name}>
                <span className="font-mono">{m.eco}</span> {m.name}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/60">{t("bookMove")}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Spinner() {
  const t = useTranslations("common");
  return (
    <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {t("loading")}
    </p>
  );
}

/** Opening explorer: masters / online statistics through our backend, or our own CC0 book. */
export function ExplorerPanel({
  fen,
  ply,
  onPlay,
}: {
  fen: string;
  /** Ply of the shown position (0 = start), used for figurine colors. */
  ply: number;
  onPlay: (uci: string) => void;
}) {
  const t = useTranslations("explorer");
  const { explorerDb, update } = useSettings();
  const source: Source = explorerDb;
  const online = useExplorer(fen, source === "book" ? null : source);
  const unavailable = online.status === "error";

  return (
    <section aria-label={t("title")} className="pb-1">
      <div role="tablist" aria-label={t("source")} className="flex gap-1 px-2 pt-2">
        {SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={source === s}
            onClick={() => update({ explorerDb: s })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition",
              source === s ? "bg-secondary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`sources.${s}`)}
          </button>
        ))}
      </div>

      {online.status === "ok" && online.data.opening && (
        <p className="flex items-center gap-2 px-3 pt-2 text-xs">
          <BookOpen className="size-3.5 shrink-0 text-gold" aria-hidden />
          <span className="font-mono text-muted-foreground">{online.data.opening.eco}</span>
          <span className="truncate">{online.data.opening.name}</span>
        </p>
      )}

      <div className="pt-1">
        {source === "book" ? (
          <BookList fen={fen} ply={ply} onPlay={onPlay} />
        ) : online.status === "ok" ? (
          <StatsTable result={online.data} ply={ply} onPlay={onPlay} />
        ) : unavailable ? (
          <>
            <p className="mx-3 my-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {online.code === "explorer_unavailable" || online.code === "backend_unreachable"
                ? t("fallbackNoAccess")
                : online.code === "upstream_rate_limited" || online.code === "rate_limited"
                  ? t("fallbackRateLimited")
                  : t("fallbackError")}
            </p>
            <BookList fen={fen} ply={ply} onPlay={onPlay} />
          </>
        ) : (
          <Spinner />
        )}
      </div>

      {online.status === "ok" && online.data.topGames.length > 0 && (
        <div className="border-t px-3 py-2">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("topGames")}</h3>
          <ul className="space-y-0.5 text-xs">
            {online.data.topGames.map((g) => (
              <li key={g.id}>
                <a
                  href={g.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent"
                >
                  <span className="w-8 shrink-0 font-mono text-muted-foreground">
                    {g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : "½"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {g.white.name} {g.white.rating ? `(${g.white.rating})` : ""} – {g.black.name}{" "}
                    {g.black.rating ? `(${g.black.rating})` : ""}
                  </span>
                  <span className="text-muted-foreground">{g.year ?? ""}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {source !== "book" && online.status === "ok" && (
        <p className="px-3 pt-1 text-[10px] text-muted-foreground/70">{t("attribution")}</p>
      )}
    </section>
  );
}
