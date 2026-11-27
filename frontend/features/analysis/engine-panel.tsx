// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { uciLineToSan } from "@kingside/chess-core";
import { Cpu, Crosshair, ListPlus, Minus, MoveRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { formatScore } from "@/components/eval-bar";
import { Switch } from "@/components/ui/switch";
import { HintTooltip } from "@/components/ui/tooltip";
import { engineLabel } from "@/engine/stockfish-engine";
import { countLegalMovesCapped, type EngineSnapshot, type EngineState } from "@/engine/use-engine-analysis";
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

const LINE_PLIES = 8;
/** Moves added to the game by "add line". */
const ADD_LINE_PLIES = 8;

function PvMoveStrip({
  sans,
  pv,
  firstColor,
  moveNo,
  notation,
  playLineTitle,
  onPlayLine,
}: {
  sans: readonly string[];
  pv: readonly string[];
  firstColor: "white" | "black";
  moveNo: number;
  notation: ReturnType<typeof useSettings.getState>["notation"];
  playLineTitle: string;
  onPlayLine: (ucis: string[]) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const pvKey = pv.slice(0, sans.length).join(" ");

  const fitMoves = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    for (const child of children) {
      child.style.display = "";
    }
    const limit = container.clientWidth;
    if (limit <= 0) return;
    let clipped = false;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      if (clipped || (i > 0 && child.offsetLeft + child.offsetWidth > limit + 0.5)) {
        clipped = true;
        child.style.display = "none";
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever PV sequence or notation formatting changes
  useLayoutEffect(() => {
    fitMoves();
  }, [fitMoves, pvKey, notation, firstColor, moveNo]);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitMoves());
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitMoves]);

  return (
    <span
      ref={ref}
      className="relative flex min-w-0 flex-1 flex-nowrap items-center gap-x-0.5 overflow-hidden whitespace-nowrap font-mono text-xs leading-5"
    >
      {sans.map((san, i) => {
        const color = (i % 2 === 0) === (firstColor === "white") ? "white" : "black";
        const number =
          color === "white"
            ? `${moveNo + Math.floor((i + (firstColor === "black" ? 1 : 0)) / 2)}.`
            : i === 0
              ? `${moveNo}…`
              : "";
        const lineSlice = pv.slice(0, i + 1);
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a line is a fixed sequence
            key={i}
            type="button"
            onClick={() => onPlayLine(lineSlice)}
            title={playLineTitle}
            className="group/mv inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded px-0.5 hover:bg-primary hover:text-primary-foreground"
          >
            {number && (
              <span className="text-muted-foreground group-hover/mv:text-primary-foreground">{number}</span>
            )}
            {formatSan(san, notation, color)}
          </button>
        );
      })}
    </span>
  );
}

export function EnginePanel({
  fen,
  engine,
  gameOver,
  onPlayLine,
  threatEnabled = false,
  onThreatChange,
  threatSnapshot = null,
  threatTargetFen = null,
  threatUnavailableInCheck = false,
}: {
  fen: string;
  engine: EngineState;
  gameOver: string | null;
  /** Plays these moves (UCI) from the current position, e.g. an engine line up to a clicked move. */
  onPlayLine: (ucis: string[]) => void;
  threatEnabled?: boolean;
  onThreatChange?: ((next: boolean) => void) | undefined;
  threatSnapshot?: EngineSnapshot | null;
  threatTargetFen?: string | null;
  threatUnavailableInCheck?: boolean;
}) {
  const t = useTranslations("engine");
  const { engineEnabled, engineDepth, engineLines, notation, analysisNet, update } = useSettings();
  const firstColor = fen.split(" ")[1] === "b" ? "black" : "white";
  const moveNo = Number(fen.split(" ")[5]) || 1;
  const { snapshot, source, loading, error } = engine;
  const best = snapshot?.lines[0];
  const bestSan = best ? uciLineToSan(fen, best.pv, 1)[0] : undefined;
  const target = engineDepth ?? null;
  const depthPct =
    snapshot && target ? Math.min(100, (snapshot.depth / target) * 100) : snapshot?.done ? 100 : 0;
  const running = engineEnabled && !gameOver;

  const legalMoveCount = useMemo(
    () => (gameOver ? 0 : countLegalMovesCapped(fen, engineLines)),
    [fen, gameOver, engineLines],
  );

  const expectedLines = Math.min(engineLines, legalMoveCount);
  const visibleLines = snapshot?.lines ?? [];
  const placeholderCount = gameOver
    ? 0
    : !snapshot?.done
      ? Math.max(0, expectedLines - visibleLines.length)
      : visibleLines.length === 0 && (error || loading !== null)
        ? 1
        : 0;

  const topThreat = threatSnapshot?.lines[0];
  const threatSan =
    topThreat && threatTargetFen ? uciLineToSan(threatTargetFen, topThreat.pv, 1)[0] : undefined;
  const threatColor = firstColor === "white" ? "black" : "white";

  return (
    <section aria-label={t("title")} className="border-b">
      {/* Control strip (single row, never wraps or overflows horizontally) */}
      <div className="flex flex-nowrap items-center gap-1 px-2 pt-2 pb-1 text-xs">
        <HintTooltip label={engineLabel(analysisNet)} shortcut="L" description={t("engineToggleHint")}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
            <Switch
              id="engine-switch"
              size="sm"
              checked={engineEnabled}
              onCheckedChange={(v) => update({ engineEnabled: v })}
            />
            <label htmlFor="engine-switch" className="flex min-w-0 cursor-pointer items-center gap-1">
              <Cpu className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate text-[11px]">{engineLabel(analysisNet)}</span>
            </label>
          </span>
        </HintTooltip>

        {onThreatChange && (
          <HintTooltip label={t("threat")} shortcut="X" description={t("threatHint")}>
            <button
              type="button"
              aria-pressed={threatEnabled}
              onClick={() => onThreatChange(!threatEnabled)}
              className={cn(
                "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium transition",
                threatEnabled
                  ? "border-destructive/60 bg-destructive/15 text-destructive"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Crosshair className="size-3 shrink-0" aria-hidden />
              <span>{t("threat")}</span>
            </button>
          </HintTooltip>
        )}

        <fieldset className="flex shrink-0 rounded-full border p-0.5 text-[11px]" aria-label={t("net")}>
          {(["lite", "full"] as const).map((net) => (
            <button
              key={net}
              type="button"
              aria-pressed={analysisNet === net}
              title={t(`netHint.${net}`)}
              onClick={() => update({ analysisNet: net })}
              className={cn(
                "min-h-5 rounded-full px-1.5 py-0.5 leading-none transition",
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

      {threatEnabled && !gameOver && (
        <div
          aria-live="polite"
          className="mx-2.5 mt-0.5 mb-1 flex min-w-0 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
        >
          <Crosshair className="size-3.5 shrink-0" aria-hidden />
          {threatUnavailableInCheck ? (
            <span className="truncate">{t("threatInCheck")}</span>
          ) : threatSan && topThreat ? (
            <span className="truncate font-medium">
              {t("threatBest", {
                move: formatSan(threatSan, notation, threatColor),
                score: formatScore(topThreat.score),
              })}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{t("loading")}</span>
          )}
        </div>
      )}

      {engineEnabled && (
        <>
          {/* Readout: evaluation, best move, search meter */}
          <div className="grid min-h-11 grid-cols-[auto_1fr_auto] items-end gap-x-2.5 px-2.5 pt-1">
            <div
              className="font-mono text-2xl font-semibold tabular-nums leading-none"
              title={t("evaluation")}
            >
              {gameOver ? "—" : best ? formatScore(best.score) : "…"}
            </div>
            <div className="min-h-8 min-w-0 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap items-center gap-1.5 leading-4">
                {bestSan && running ? (
                  <span>
                    {t("best")}{" "}
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {formatSan(bestSan, notation, firstColor)}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs" aria-hidden>
                    &nbsp;
                  </span>
                )}
                {snapshot && source === "cache" && (
                  <span className="inline-flex items-center rounded-full border bg-secondary px-1.5 py-px font-mono text-[10px] font-medium text-foreground">
                    {t("cacheBadge", { depth: snapshot.depth })}
                  </span>
                )}
              </div>
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
              <span className="text-[11px] text-muted-foreground">{t("lines")}</span>
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
            className="mx-2.5 mt-1.5 h-1 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label={loading !== null && !snapshot ? t("downloadLabel") : t("depthLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(loading !== null && !snapshot ? loading * 100 : depthPct)}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                loading !== null && !snapshot ? "bg-gold" : "bg-gradient-to-r from-primary/60 to-primary",
              )}
              style={{ width: `${loading !== null && !snapshot ? loading * 100 : depthPct}%` }}
            />
          </div>

          {/* 4-column no-overflow Pace strip */}
          <fieldset className="grid grid-cols-4 gap-1 px-2.5 py-1.5 text-[11px]" aria-label={t("pace")}>
            {PACES.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={engineDepth === p.depth}
                onClick={() => update({ engineDepth: p.depth })}
                className={cn(
                  "flex min-h-6 min-w-0 items-center justify-center gap-0.5 rounded-md border px-1 transition",
                  engineDepth === p.depth
                    ? "border-primary bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="truncate">{t(`paces.${p.id}`)}</span>
                <span
                  className={cn(
                    "shrink-0 font-mono",
                    engineDepth === p.depth ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {p.depth ?? "∞"}
                </span>
              </button>
            ))}
          </fieldset>

          {/* Compact single-line Multi-PV candidate lines (1–5 lines visible, bounded internal scroll) */}
          <ol
            className="space-y-0.5 px-2 pb-1.5 md:max-h-[clamp(5.5rem,calc(100dvh-30.5rem),11rem)] md:overflow-y-auto"
            aria-busy={!gameOver && !snapshot?.done}
          >
            {gameOver ? (
              <li className="px-1 py-1.5 text-sm text-muted-foreground">{gameOver}</li>
            ) : (
              <>
                {visibleLines.map((line, index) => {
                  const sans = uciLineToSan(fen, line.pv, LINE_PLIES);
                  const firstMove = line.pv[0];
                  const whiteBetter =
                    line.score.mate !== undefined ? line.score.mate > 0 : line.score.cp >= 0;
                  return (
                    <li
                      key={line.multipv}
                      className={cn(
                        "group flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 transition hover:border-border hover:bg-accent/40",
                        index === 0 && "border-primary/30 bg-primary/5",
                      )}
                    >
                      <span
                        className={cn(
                          "w-12 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[11px] font-bold leading-none tabular-nums",
                          whiteBetter
                            ? "bg-[var(--eval-white-bg)] text-[var(--eval-white-fg)] ring-1 ring-inset ring-border"
                            : "bg-[var(--eval-black-bg)] text-[var(--eval-black-fg)]",
                        )}
                      >
                        {formatScore(line.score)}
                      </span>
                      <PvMoveStrip
                        sans={sans}
                        pv={line.pv}
                        firstColor={firstColor}
                        moveNo={moveNo}
                        notation={notation}
                        playLineTitle={t("playLineTo")}
                        onPlayLine={onPlayLine}
                      />
                      <span className="flex shrink-0 gap-0.5 opacity-70 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => {
                            if (firstMove) onPlayLine([firstMove]);
                          }}
                          title={t("playMove")}
                          aria-label={t("playMove")}
                          className="grid size-6 place-items-center rounded hover:bg-primary hover:text-primary-foreground"
                        >
                          <MoveRight className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onPlayLine(line.pv.slice(0, ADD_LINE_PLIES))}
                          title={t("addLine", { n: Math.min(ADD_LINE_PLIES, line.pv.length) })}
                          aria-label={t("addLine", { n: Math.min(ADD_LINE_PLIES, line.pv.length) })}
                          className="grid size-6 place-items-center rounded hover:bg-primary hover:text-primary-foreground"
                        >
                          <ListPlus className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  );
                })}
                {/* Placeholders keep the panel steady while active lines arrive (never shown once done). */}
                {Array.from({ length: placeholderCount }, (_, k) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
                    key={`ph-${k}`}
                    className="flex h-7 items-center gap-1.5 px-1.5 text-xs text-muted-foreground"
                  >
                    <span className="h-5 w-12 shrink-0 animate-pulse rounded bg-secondary" />
                    {k === 0 && visibleLines.length === 0 ? (
                      <span className={cn("truncate leading-5", error && "text-destructive")}>
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
                      <span className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
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
