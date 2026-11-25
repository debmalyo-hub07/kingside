// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { explainMove, type MoveReview, type Reason } from "@kingside/chess-core";
import { ChevronsRight, Eye, Lightbulb, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatScore } from "@/components/eval-bar";
import { Button } from "@/components/ui/button";
import { formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { MoveClassBadge } from "./move-classes";
import { useReview } from "./review-store";

export type RetryState = {
  ply: number;
  result: "pending" | "checking" | "correct" | "alsoGood" | "wrong";
  tried?: string;
  /** 0 = none, 1 = piece highlighted, 2 = best move shown. */
  hint: 0 | 1 | 2;
};

/** An engine line shown on the board instead of the game, after `plies` of its moves. */
export type Preview = { line: "best" | "reply"; plies: number };

export const RETRYABLE = new Set(["inaccuracy", "mistake", "miss", "blunder"]);

function moveNumber(m: { ply: number; color: "white" | "black" }): string {
  return m.color === "white" ? `${Math.ceil(m.ply / 2)}.` : `${Math.ceil(m.ply / 2)}…`;
}

type T = ReturnType<typeof useTranslations<"review.report">>;

function reasonText(r: Reason, t: T): string {
  switch (r.code) {
    case "mates":
    case "allowsMate":
    case "missedMate":
      return t(`reasons.${r.code}`, { n: r.n });
    case "hangs":
    case "allowsFork":
    case "sacrifice":
    case "discoveredAttack":
    case "allowsDiscoveredAttack":
    case "trapsPiece":
    case "trappedPiece":
    case "deflection":
    case "allowsDeflection":
      return t(`reasons.${r.code}`, { piece: t(`pieces.${r.piece}`), square: r.square });
    case "pins":
    case "allowsPin":
    case "skewers":
    case "allowsSkewer":
      return t(`reasons.${r.code}`, {
        piece: t(`pieces.${r.piece}`),
        target: t(`pieces.${r.target}`),
        square: r.square,
      });
    case "backRank":
    case "allowsBackRank":
      return t(`reasons.${r.code}`, { square: r.square });
    case "missedTactic":
      return t("reasons.missedTactic", { motif: r.motif });
    case "losesMaterial":
    case "bestWinsMaterial":
      return t(`reasons.${r.code}`, { pawns: r.pawns });
    case "swing":
      return t("reasons.swing", { from: t(`outlook.${r.from}`), to: t(`outlook.${r.to}`) });
    default:
      return t(`reasons.${r.code}`);
  }
}

/** Clickable SAN chips for an engine line, numbered from `startPly` (the ply of the first move). */
function LineChips({
  sans,
  startPly,
  active,
  onPick,
  label,
}: {
  sans: string[];
  startPly: number;
  active: number | null;
  onPick: (plies: number) => void;
  label: string;
}) {
  const notation = useSettings((s) => s.notation);
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="mr-1 text-muted-foreground">{label}</span>
      {sans.map((san, i) => {
        const ply = startPly + i;
        const color = ply % 2 === 1 ? "white" : "black";
        const showNumber = color === "white" || i === 0;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a line is a fixed sequence
            key={i}
            type="button"
            onClick={() => onPick(i + 1)}
            aria-pressed={active === i + 1}
            className={cn(
              "inline-flex min-h-6 min-w-6 items-center justify-center rounded-md px-1.5 py-0.5 font-mono transition hover:bg-accent",
              active === i + 1 && "bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            {showNumber && (
              <span className="opacity-60">
                {color === "white" ? `${Math.ceil(ply / 2)}.` : `${Math.ceil(ply / 2)}…`}
              </span>
            )}
            {formatSan(san, notation, color)}
          </button>
        );
      })}
    </div>
  );
}

export function CoachCard({
  move,
  previous,
  retry,
  setRetry,
  preview,
  setPreview,
  onRetryStart,
  onNextKey,
  hasNextKey,
}: {
  move: MoveReview | undefined;
  previous: MoveReview | undefined;
  retry: RetryState | null;
  setRetry: (r: RetryState | null) => void;
  preview: Preview | null;
  setPreview: (p: Preview | null) => void;
  onRetryStart: () => void;
  onNextKey: () => void;
  hasNextKey: boolean;
}) {
  const t = useTranslations("review.report");
  const classLabel = useTranslations("classes");
  const notation = useSettings((s) => s.notation);
  const { positions, moves, moveTimes, review, opening } = useReview();

  const header = (
    <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {t("tacticalGuide")}
    </h2>
  );

  if (!move) {
    return (
      <div className="space-y-3 p-4">
        {header}
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
        {review && review.lastBookPly > 0 && (
          <p className="text-sm">{t("bookUntil", { n: Math.ceil(review.lastBookPly / 2) })}</p>
        )}
        {hasNextKey && (
          <Button size="sm" onClick={onNextKey}>
            <ChevronsRight /> {t("firstKey")}
          </Button>
        )}
      </div>
    );
  }

  const before = positions[move.ply - 1];
  const after = positions[move.ply];
  const uci = moves[move.ply - 1]?.uci ?? "";
  const reasons = before && after ? explainMove(move, before, after, uci, previous) : [];
  const san = (s: string, color: "white" | "black") => formatSan(s, notation, color);
  const spent = moveTimes[move.ply - 1];
  const notBest = !["best", "book", "forced", "brilliant", "great"].includes(move.classification);
  const showBest = notBest && move.bestLine && move.bestLine.length > 0;
  const headline = t(`headline.${move.classification}`, {
    move: `${moveNumber(move)} ${san(move.san, move.color)}`,
  });

  return (
    <div className="space-y-3 p-4" aria-live="polite">
      {header}
      <div className="flex items-start gap-3">
        <MoveClassBadge cls={move.classification} className="mt-0.5 size-8 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{headline}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{classLabel(move.classification)}</p>
        </div>
        {move.scoreBefore && move.scoreAfter && (
          <span
            className="shrink-0 rounded-lg bg-secondary px-2 py-1 font-mono text-xs"
            title={t("evalChange")}
          >
            {formatScore(move.scoreBefore)} → {formatScore(move.scoreAfter)}
          </span>
        )}
      </div>

      {review && move.ply === review.lastBookPly && (
        <p className="text-sm leading-relaxed">
          {opening ? t("lastBookNamed", { opening: opening.name }) : t("lastBook")}
        </p>
      )}

      {reasons.length > 0 && (
        <ul className="space-y-1 text-sm leading-relaxed">
          {reasons.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: reasons are a short fixed list
            <li key={i}>{reasonText(r, t)}</li>
          ))}
        </ul>
      )}

      {showBest && move.bestLine && (
        <LineChips
          label={t("bestLine")}
          sans={move.bestLine.slice(0, 6)}
          startPly={move.ply}
          active={preview?.line === "best" ? preview.plies : null}
          onPick={(plies) => setPreview({ line: "best", plies })}
        />
      )}
      {move.replyLine && move.replyLine.length > 0 && (
        <LineChips
          label={notBest ? t("punishLine") : t("replyLine")}
          sans={move.replyLine.slice(0, 6)}
          startPly={move.ply + 1}
          active={preview?.line === "reply" ? preview.plies : null}
          onPick={(plies) => setPreview({ line: "reply", plies })}
        />
      )}
      {preview && (
        <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
          <Undo2 /> {t("backToGame")}
        </Button>
      )}

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t("winChance", { from: Math.round(move.winBefore), to: Math.round(move.winAfter) })}</span>
        {move.depth ? <span>{t("depth", { depth: move.depth })}</span> : null}
        {spent !== null && spent !== undefined && <span>{t("timeSpent", { s: formatSeconds(spent) })}</span>}
      </p>

      {retry ? (
        <RetryPanel move={move} retry={retry} setRetry={setRetry} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {RETRYABLE.has(move.classification) && (
            <Button size="sm" variant="secondary" onClick={onRetryStart}>
              <RotateCcw /> {t("retry.start")}
            </Button>
          )}
          {hasNextKey && (
            <Button size="sm" variant="ghost" onClick={onNextKey}>
              <ChevronsRight /> {t("nextKey")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RetryPanel({
  move,
  retry,
  setRetry,
}: {
  move: MoveReview;
  retry: RetryState;
  setRetry: (r: RetryState | null) => void;
}) {
  const t = useTranslations("review.report");
  const notation = useSettings((s) => s.notation);
  const best = move.bestSan ? formatSan(move.bestSan, notation, move.color) : "?";
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2 text-sm",
        (retry.result === "correct" || retry.result === "alsoGood") && "bg-primary/15 text-primary",
        retry.result === "wrong" && "bg-destructive/10 text-destructive",
        (retry.result === "pending" || retry.result === "checking") && "bg-secondary",
      )}
      role="status"
    >
      {retry.result === "pending" && t("retry.pending")}
      {retry.result === "checking" && t("retry.checking", { move: retry.tried ?? "" })}
      {retry.result === "correct" && t("retry.correct", { move: retry.tried ?? "" })}
      {retry.result === "alsoGood" && t("retry.alsoGood", { move: retry.tried ?? "", best })}
      {retry.result === "wrong" && t("retry.wrongNoBest", { move: retry.tried ?? "" })}
      <div className="mt-2 flex flex-wrap gap-2">
        {retry.result === "pending" && retry.hint < 2 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRetry({ ...retry, hint: retry.hint === 0 ? 1 : 2 })}
          >
            {retry.hint === 0 ? <Lightbulb /> : <Eye />}{" "}
            {retry.hint === 0 ? t("retry.hint") : t("retry.show")}
          </Button>
        )}
        {retry.result === "wrong" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRetry({ ply: retry.ply, result: "pending", hint: 0 })}
          >
            <RotateCcw /> {t("retry.again")}
          </Button>
        )}
        {retry.result === "wrong" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRetry({ ...retry, result: "pending", hint: 2 })}
          >
            <Eye /> {t("retry.show")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setRetry(null)}>
          <Undo2 /> {t("retry.back")}
        </Button>
      </div>
    </div>
  );
}

export function formatSeconds(s: number): string {
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}
