// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { uciLineToSan } from "@kingside/chess-core";
import { Cpu, ListPlus, Minus, MoveRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatScore } from "@/components/eval-bar";
import { Switch } from "@/components/ui/switch";
import { engineLabel } from "@/engine/stockfish-engine";
import type { EngineState } from "@/engine/use-engine-analysis";
import { formatSan } from "@/lib/notation";
import { type EngineDepth, useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

function formatNps(nps: number | undefined): string {
  if (!nps) return "—";
  return nps >= 1e6 ? `${(nps / 1e6).toFixed(1)}M` : `${Math.round(nps / 1e3)}k`;
}

/** Search-length presets shown as chips (values are DEPTH_OPTIONS entries). */
const PACES: { id: "glance" | "steady" | "deep" | "endless"; depth: EngineDepth }[] = [
  { id: "glance", depth: 16 },
  { id: "steady", depth: 24 },
  { id: "deep", depth: 32 },
  { id: "endless", depth: null },
];

const LINE_PLIES = 12;
/** Moves added to the game by "add line". */
const ADD_LINE_PLIES = 8;

export function EnginePanel({
  fen,
  engine,
  gameOver,
  onPlayLine,
}: {
  fen: string;
  engine: EngineState;
  gameOver: string | null;
  /** Plays these moves (UCI) from the current position, e.g. an engine line up to a clicked move. */
  onPlayLine: (ucis: string[]) => void;
}) {
  const t = useTranslations("engine");
  const { engineEnabled, engineDepth, engineLines, notation, analysisNet, update } = useSettings();
  const firstColor = fen.split(" ")[1] === "b" ? "black" : "white";
  const moveNo = Number(fen.split(" ")[5]) || 1;
  const { snapshot, loading, error } = engine;
  const best = snapshot?.lines[0];
  const bestSan = best ? uciLineToSan(fen, best.pv, 1)[0] : undefined;
  const target = engineDepth ?? null;
  const depthPct =
    snapshot && target ? Math.min(100, (snapshot.depth / target) * 100) : snapshot?.done ? 100 : 0;
  const running = engineEnabled && !gameOver;

  return (
    <section aria-label={t("title")} className="border-b">
      {/* Control strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2.5 text-xs">
        <span className="flex items-center gap-2 font-medium">
          <Switch
            id="engine-switch"
            checked={engineEnabled}
            onCheckedChange={(v) => update({ engineEnabled: v })}
          />
          <label htmlFor="engine-switch" className="flex cursor-pointer items-center gap-1.5">
            <Cpu className="size-4" aria-hidden />
            {engineLabel(analysisNet)}
          </label>
        </span>
        <fieldset className="ml-auto flex rounded-full border p-0.5" aria-label={t("net")}>
          {(["lite", "full"] as const).map((net) => (
            <button
              key={net}
              type="button"
              aria-pressed={analysisNet === net}
              title={t(`netHint.${net}`)}
              onClick={() => update({ analysisNet: net })}
              className={cn(
                "min-h-6 rounded-full px-2.5 transition",
                analysisNet === net
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`nets.${net}`)}
            </button>
          ))}
        </fieldset>
      </div>

      {engineEnabled && (
        <>
          {/* Readout: evaluation, best move, search meter */}
          <div className="grid min-h-14 grid-cols-[auto_1fr_auto] items-end gap-x-4 px-3 pt-3">
            <div
              className="font-mono text-3xl font-semibold tabular-nums leading-none"
              title={t("evaluation")}
            >
              {gameOver ? "—" : best ? formatScore(best.score) : "…"}
            </div>
            <div className="min-h-9 min-w-0 pb-0.5 text-xs text-muted-foreground">
              {bestSan && running ? (
                <span className="block leading-5">
                  {t("best")}{" "}
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {formatSan(bestSan, notation, firstColor)}
                  </span>
                </span>
              ) : (
                <span className="block text-sm leading-5" aria-hidden>
                  &nbsp;
                </span>
              )}
              <span className="mt-0.5 block truncate">
                {running
                  ? t("meter", {
                      depth: snapshot?.depth ?? 0,
                      target: target === null ? "∞" : String(target),
                      nps: formatNps(snapshot?.nps),
                      threads: engine.threads,
                    })
                  : t("off")}
                {snapshot?.done && running ? ` · ${t("done")}` : ""}
              </span>
            </div>
            <fieldset className="flex items-center gap-1 pb-0.5 text-xs" aria-label={t("lines")}>
              <span className="text-muted-foreground">{t("lines")}</span>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-md border hover:bg-accent disabled:opacity-40"
                onClick={() => update({ engineLines: Math.max(1, engineLines - 1) })}
                disabled={engineLines <= 1}
                aria-label={t("fewerLines")}
              >
                <Minus className="size-3" />
              </button>
              <span className="w-4 text-center font-mono">{engineLines}</span>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-md border hover:bg-accent disabled:opacity-40"
                onClick={() => update({ engineLines: Math.min(5, engineLines + 1) })}
                disabled={engineLines >= 5}
                aria-label={t("moreLines")}
              >
                <Plus className="size-3" />
              </button>
            </fieldset>
          </div>
          <div
            className="mx-3 mt-2 h-1 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label={loading !== null ? t("downloadLabel") : t("depthLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(loading !== null ? loading * 100 : depthPct)}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                loading !== null ? "bg-gold" : "bg-gradient-to-r from-primary/60 to-primary",
              )}
              style={{ width: `${loading !== null ? loading * 100 : depthPct}%` }}
            />
          </div>

          {/* Pace + lines */}
          <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 text-xs">
            <fieldset className="flex shrink-0 gap-1" aria-label={t("pace")}>
              {PACES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={engineDepth === p.depth}
                  onClick={() => update({ engineDepth: p.depth })}
                  className={cn(
                    "min-h-6 rounded-md border px-2 transition",
                    engineDepth === p.depth
                      ? "border-primary bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`paces.${p.id}`)}
                  <span className="ml-1 font-mono opacity-60">{p.depth ?? "∞"}</span>
                </button>
              ))}
            </fieldset>
          </div>

          {/* Lines */}
          <ol className="space-y-1 px-2 pb-2" aria-busy={!snapshot?.done}>
            {gameOver ? (
              <li className="px-1 py-1.5 text-sm text-muted-foreground">{gameOver}</li>
            ) : (
              <>
                {(snapshot?.lines ?? []).map((line, index) => {
                  const sans = uciLineToSan(fen, line.pv, LINE_PLIES);
                  const firstMove = line.pv[0];
                  const whiteBetter =
                    line.score.mate !== undefined ? line.score.mate > 0 : line.score.cp >= 0;
                  return (
                    <li
                      key={line.multipv}
                      className={cn(
                        "group flex h-14 items-start gap-2 overflow-hidden rounded-lg border border-transparent px-1.5 py-1 transition hover:border-border hover:bg-accent/40",
                        index === 0 && "border-primary/30 bg-primary/5",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 w-14 shrink-0 rounded px-1 text-center font-mono text-xs font-bold",
                          whiteBetter ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-100",
                        )}
                      >
                        {formatScore(line.score)}
                      </span>
                      <span className="line-clamp-2 min-w-0 flex-1 font-mono text-sm leading-6">
                        {sans.map((san, i) => {
                          const color = (i % 2 === 0) === (firstColor === "white") ? "white" : "black";
                          const number =
                            color === "white"
                              ? `${moveNo + Math.floor((i + (firstColor === "black" ? 1 : 0)) / 2)}.`
                              : i === 0
                                ? `${moveNo}…`
                                : "";
                          return (
                            <button
                              // biome-ignore lint/suspicious/noArrayIndexKey: a line is a fixed sequence
                              key={i}
                              type="button"
                              onClick={() => onPlayLine(line.pv.slice(0, i + 1))}
                              title={t("playLineTo")}
                              className="inline-flex min-h-6 min-w-6 items-center justify-center rounded px-0.5 hover:bg-primary hover:text-primary-foreground"
                            >
                              {number && <span className="opacity-60">{number}</span>}
                              {formatSan(san, notation, color)}
                            </button>
                          );
                        })}
                      </span>
                      <span className="flex shrink-0 gap-0.5 opacity-70 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => firstMove && onPlayLine([firstMove])}
                          title={t("playMove")}
                          aria-label={t("playMove")}
                          className="grid size-6 place-items-center rounded-md hover:bg-primary hover:text-primary-foreground"
                        >
                          <MoveRight className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onPlayLine(line.pv.slice(0, ADD_LINE_PLIES))}
                          title={t("addLine", { n: Math.min(ADD_LINE_PLIES, line.pv.length) })}
                          aria-label={t("addLine", { n: Math.min(ADD_LINE_PLIES, line.pv.length) })}
                          className="grid size-6 place-items-center rounded-md hover:bg-primary hover:text-primary-foreground"
                        >
                          <ListPlus className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  );
                })}
                {/* Placeholders keep the panel the same height while lines arrive (no layout jumps). */}
                {Array.from({ length: Math.max(0, engineLines - (snapshot?.lines.length ?? 0)) }, (_, k) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
                    key={`ph-${k}`}
                    className="flex h-14 items-start gap-2 px-1.5 py-1 text-sm text-muted-foreground"
                  >
                    <span className="mt-0.5 h-5 w-14 shrink-0 animate-pulse rounded bg-secondary" />
                    {k === 0 && !snapshot?.lines.length ? (
                      <span className={cn("leading-6", error && "text-destructive")}>
                        {error
                          ? t("failed")
                          : loading !== null
                            ? t("downloading", {
                                pct: Math.round(loading * 100),
                                size: analysisNet === "lite" ? "2 MB" : "99 MB",
                              })
                            : t("loading")}
                      </span>
                    ) : (
                      <span className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-secondary" />
                    )}
                  </li>
                ))}
              </>
            )}
          </ol>
        </>
      )}
    </section>
  );
}
