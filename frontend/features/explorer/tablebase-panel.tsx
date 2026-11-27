// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { colorOfPly, formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import type { Loadable, TablebaseMove, TablebaseResult, TbCategory } from "./explorer-data";

type Verdict = "win" | "draw" | "loss" | "unknown";

/** Category of the position for the side to move. */
function verdict(c: TbCategory): Verdict {
  if (c === "win" || c === "syzygy-win" || c === "maybe-win") return "win";
  if (c === "loss" || c === "syzygy-loss" || c === "maybe-loss") return "loss";
  if (c === "draw" || c === "cursed-win" || c === "blessed-loss") return "draw";
  return "unknown";
}

/** A move's category is given for the opponent (who moves next); flip it for the mover. */
function moveVerdict(m: TablebaseMove): Verdict {
  const v = verdict(m.category);
  return v === "win" ? "loss" : v === "loss" ? "win" : v;
}

const VERDICT_STYLE: Record<Verdict, string> = {
  win: "bg-primary/15 text-primary",
  draw: "bg-secondary text-foreground",
  loss: "bg-destructive/10 text-destructive",
  unknown: "bg-secondary text-muted-foreground",
};

/** Perfect-play verdict and move list from the 7-piece Syzygy tablebase. */
export function TablebasePanel({
  state,
  ply,
  onPlay,
  onPreviewMove,
}: {
  state: Loadable<TablebaseResult>;
  ply: number;
  onPlay: (uci: string) => void;
  onPreviewMove?: ((ucis: string[] | null) => void) | undefined;
}) {
  const t = useTranslations("tablebase");
  const notation = useSettings((s) => s.notation);
  const mover = colorOfPly(ply + 1);
  const distance = (m: { dtm: number | null; dtz: number | null; category: TbCategory }, v: Verdict) =>
    v === "draw" || v === "unknown"
      ? ""
      : m.dtm !== null && m.dtm !== 0
        ? t("dtm", { n: Math.abs(m.dtm) })
        : m.dtz !== null && m.dtz !== 0
          ? t("dtz", { n: Math.abs(m.dtz) })
          : "";

  if (state.status === "idle" || state.status === "loading")
    return (
      <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t("loading")}
      </p>
    );
  if (state.status === "error")
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">
        {state.code === "backend_unreachable" ? t("offline") : t("error")}
      </p>
    );

  const r = state.data;
  const v = verdict(r.category);
  const headline = r.checkmate
    ? t("checkmate")
    : r.stalemate
      ? t("stalemate")
      : r.insufficientMaterial
        ? t("insufficient")
        : t(`verdict.${v}`, { side: mover === "white" ? t("white") : t("black") });

  return (
    <section aria-label={t("title")} className="pb-1">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn("rounded-md px-2 py-0.5 text-sm font-semibold", VERDICT_STYLE[v])}>
          {headline}
        </span>
        <span className="text-xs text-muted-foreground">{distance(r, v)}</span>
        {(r.category === "cursed-win" || r.category === "blessed-loss") && (
          <span className="text-xs text-gold" title={t("fiftyMoveHint")}>
            {t("fiftyMove")}
          </span>
        )}
      </div>
      <ul onMouseLeave={() => onPreviewMove?.(null)}>
        {r.moves.map((m) => {
          const mv = moveVerdict(m);
          return (
            <li key={m.uci}>
              <button
                type="button"
                onMouseEnter={() => onPreviewMove?.([m.uci])}
                onMouseLeave={() => onPreviewMove?.(null)}
                onFocus={() => onPreviewMove?.([m.uci])}
                onBlur={() => onPreviewMove?.(null)}
                onClick={() => {
                  onPreviewMove?.(null);
                  onPlay(m.uci);
                }}
                className="flex w-full items-center gap-3 px-3 py-1 text-left hover:bg-accent"
              >
                <span className="w-16 shrink-0 font-mono text-sm font-semibold">
                  {formatSan(m.san, notation, mover)}
                </span>
                <span className={cn("rounded px-1.5 text-xs font-medium", VERDICT_STYLE[mv])}>
                  {t(`short.${mv}`)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {m.checkmate ? t("mate") : m.stalemate ? t("stalemate") : distance(m, mv)}
                </span>
                {m.zeroing && !m.checkmate && (
                  <span className="ml-auto text-[10px] text-muted-foreground/70" title={t("zeroingHint")}>
                    {t("zeroing")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="px-3 pt-1 text-[10px] text-muted-foreground/70">{t("attribution")}</p>
    </section>
  );
}
