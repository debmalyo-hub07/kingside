// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen, winPercentFromScore } from "@kingside/chess-core";
import { FileSearch, LineChart, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BOARD_THEMES } from "@/lib/board-themes";
import { pieceUrl } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";
import { useInView } from "@/lib/use-in-view";
import type { LegendaryGame } from "./hero-game-data";
import { type LegendaryId, loadLegendary, useHeroGame } from "./legendary";
import { Reveal, SectionHeading } from "./reveal";

/** Static picture of a position (no board library: six of these must stay cheap). */
function MiniBoard({ fen, last, label }: { fen: string; last?: string; label: string }) {
  const { boardTheme, pieceSet } = useSettings();
  const theme = BOARD_THEMES.find((b) => b.id === boardTheme) ?? BOARD_THEMES[0];
  const pos = positionFromFen(fen);
  const lastSquares = last ? [last.slice(0, 2), last.slice(2, 4)] : [];
  const cells = [];
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const sq = rank * 8 + file;
      const name = `${"abcdefgh"[file]}${rank + 1}`;
      const piece = pos.board.get(sq);
      const light = (rank + file) % 2 === 1;
      cells.push(
        <div
          key={name}
          className="relative"
          style={{
            backgroundColor: light ? theme?.light : theme?.dark,
            boxShadow: lastSquares.includes(name) ? `inset 0 0 0 999px ${theme?.lastMove}` : undefined,
          }}
        >
          {piece && (
            // biome-ignore lint/performance/noImgElement: tiny static SVG pieces, next/image adds nothing here
            <img
              src={pieceUrl(pieceSet, piece.color, piece.role)}
              alt=""
              loading="lazy"
              draggable={false}
              className="absolute inset-0 size-full"
            />
          )}
        </div>,
      );
    }
  }
  return (
    <div role="img" aria-label={label} className="grid aspect-square grid-cols-8 overflow-hidden rounded-xl">
      {cells}
    </div>
  );
}

export function LegendaryGames() {
  const t = useTranslations("home.legendary");
  const router = useRouter();
  const setHero = useHeroGame((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "400px" });
  const [games, setGames] = useState<LegendaryGame[] | null>(null);

  useEffect(() => {
    if (inView && !games) void loadLegendary().then(setGames);
  }, [inView, games]);

  const review = async (pgn: string) => {
    const { useReview } = await import("@/features/review/review-store");
    useReview.getState().start(pgn);
    router.push("/review");
  };
  const analyze = async (pgn: string) => {
    const { useAnalysis } = await import("@/features/analysis/analysis-store");
    useAnalysis.getState().loadPgn(pgn);
    router.push("/analysis");
  };

  return (
    <section id="legendary" className="scroll-mt-24" ref={ref}>
      <SectionHeading
        eyebrow={t("eyebrow")}
        title={t.rich("title", { em: (c) => <em className="italic font-medium text-gold">{c}</em> })}
        text={t("text")}
      />
      {!games ? (
        <p className="text-center text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <ul className="-mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 lg:pb-0">
          {games.map((g, i) => {
            const id = g.id as LegendaryId;
            const final = g.plies[g.plies.length - 1];
            const lastIdx = Math.max(g.plies.length - 1, 1);
            const sparkPts = g.plies
              .map((p, idx) => {
                const w = p.score.mate === 0 ? (idx % 2 === 1 ? 100 : 0) : winPercentFromScore(p.score);
                return `${Math.round((idx / lastIdx) * 100)},${Math.round(100 - w)}`;
              })
              .join(" ");
            return (
              <li
                key={g.id}
                className="w-[82vw] max-w-xs shrink-0 snap-start sm:w-[20rem] lg:w-auto lg:max-w-none"
              >
                <Reveal delay={0.05 * (i % 3)} className="h-full">
                  <article className="panel-solid flex h-full flex-col gap-3 rounded-3xl p-4 transition-transform duration-300 hover:-translate-y-1 hover:border-primary/40 motion-reduce:hover:translate-y-0">
                    <MiniBoard fen={final?.fen ?? ""} last={final?.uci} label={t(`games.${id}.title`)} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-2xl leading-tight">{t(`games.${id}.title`)}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {g.white} – {g.black} · {g.event} · {g.result}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {t(`games.${id}.note`)}
                      </p>
                    </div>
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden
                      className="surface-well h-7 w-full rounded-lg px-0.5"
                    >
                      <line
                        x1="0"
                        y1="50"
                        x2="100"
                        y2="50"
                        stroke="currentColor"
                        strokeOpacity="0.12"
                        strokeWidth="0.6"
                      />
                      <polyline
                        points={sparkPts}
                        fill="none"
                        className="stroke-primary"
                        strokeWidth="1.4"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => {
                          setHero(id);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <Play /> {t("watch")}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void review(g.pgn)}>
                        <FileSearch /> {t("review")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void analyze(g.pgn)}>
                        <LineChart /> {t("analyze")}
                      </Button>
                    </div>
                  </article>
                </Reveal>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
