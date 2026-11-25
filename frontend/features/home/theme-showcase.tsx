// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { Key } from "chessground/types";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ChessBoard } from "@/components/board/chess-board";
import { BOARD_THEMES } from "@/lib/board-themes";
import { PIECE_SETS, pieceUrl } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { HERO_PLIES } from "./hero-game-data";
import { Reveal, SectionHeading } from "./reveal";

// Final position of the Immortal Game.
const FINAL = HERO_PLIES[HERO_PLIES.length - 1];

export function ThemeShowcase() {
  const { boardTheme, pieceSet, update } = useSettings();
  const t = useTranslations("home.themes");
  const tb = useTranslations("board.themes");
  return (
    <section id="themes" className="scroll-mt-24">
      <SectionHeading
        eyebrow={t("eyebrow")}
        title={t.rich("title", { em: (c) => <em className="text-gradient">{c}</em> })}
        text={t("text")}
      />
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <Reveal className="mx-auto w-full max-w-[26rem]">
          <div className="glass rounded-3xl p-3">
            <ChessBoard
              fen={FINAL?.fen ?? ""}
              orientation="white"
              lastMove={FINAL?.uci ? [FINAL.uci.slice(0, 2) as Key, FINAL.uci.slice(2, 4) as Key] : undefined}
              check
              turnColor="black"
            />
          </div>
        </Reveal>
        <Reveal delay={0.1} className="space-y-6">
          <div>
            <p className="mb-3 text-sm font-medium">{t("colors")}</p>
            <div className="flex flex-wrap gap-2">
              {BOARD_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => update({ boardTheme: theme.id })}
                  aria-pressed={boardTheme === theme.id}
                  aria-label={tb(theme.id)}
                  title={tb(theme.id)}
                  className={cn(
                    "size-11 rounded-xl ring-offset-2 ring-offset-background transition hover:scale-110",
                    boardTheme === theme.id && "ring-2 ring-primary",
                  )}
                  style={{
                    backgroundImage: `repeating-conic-gradient(${theme.dark} 0 25%, ${theme.light} 0 50%)`,
                    backgroundSize: "50% 50%",
                  }}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium">{t("pieces")}</p>
            <div className="flex flex-wrap gap-2">
              {PIECE_SETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update({ pieceSet: p.id })}
                  aria-pressed={pieceSet === p.id}
                  aria-label={p.name}
                  title={p.name}
                  className={cn(
                    "grid size-11 place-items-center rounded-xl border bg-secondary ring-offset-2 ring-offset-background transition hover:scale-110",
                    pieceSet === p.id && "ring-2 ring-primary",
                  )}
                >
                  <Image
                    src={pieceUrl(p.id, "white", "knight")}
                    alt=""
                    width={32}
                    height={32}
                    unoptimized
                    className="size-8"
                  />
                </button>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
