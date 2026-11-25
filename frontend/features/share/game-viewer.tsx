// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only viewer for a shared game (/g/<id>) and its embeddable version (/embed/g/<id>).
"use client";

import {
  type GameTree,
  type MoveClass,
  mainlineFrom,
  nodesAlongPath,
  positionFromFen,
  treeFromPgn,
} from "@kingside/chess-core";
import type { Key } from "chessground/types";
import {
  BookmarkPlus,
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSearch,
  FlipVertical2,
  LineChart,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { EvalBar } from "@/components/eval-bar";
import { EvalGraph, type GraphMarker } from "@/components/eval-graph";
import { Button } from "@/components/ui/button";
import { useAnalysis } from "@/features/analysis/analysis-store";
import {
  badgeSquare,
  CLASS_META,
  MoveClassBadge,
  SquareBadge,
  useClassLabel,
} from "@/features/review/move-classes";
import { useReview } from "@/features/review/review-store";
import { saveGame } from "@/lib/local-db";
import { colorOfPly, formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import type { SharedAnalysis } from "./share-actions";
import { ShareDialog } from "./share-dialog";

export interface SharedGame {
  id: string;
  pgn: string;
  analysis: SharedAnalysis | null;
  orientation: "white" | "black";
  createdAt: string;
}

const MARKED = new Set<MoveClass>(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"]);

function readHashPly(max: number): number {
  if (typeof window === "undefined") return 0;
  const n = Number.parseInt(window.location.hash.slice(1), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(n, max)) : max;
}

function header(tree: GameTree, key: string): string | null {
  const v = tree.headers.get(key);
  return v && v !== "?" && !v.startsWith("????") ? v : null;
}

export function GameViewer({ game, embed = false }: { game: SharedGame; embed?: boolean }) {
  const t = useTranslations("viewer");
  const classLabel = useClassLabel();
  const notation = useSettings((s) => s.notation);
  const router = useRouter();
  const tree = useMemo(() => treeFromPgn(game.pgn), [game.pgn]);
  const nodes = useMemo(() => nodesAlongPath(tree, mainlineFrom(tree)), [tree]);
  const max = nodes.length - 1;
  const [ply, setPly] = useState(max);
  const [orientation, setOrientation] = useState(game.orientation);
  const [saved, setSaved] = useState(false);
  const moveList = useRef<HTMLOListElement>(null);

  // #N in the URL opens the game at move N; keep the hash in sync while stepping.
  useEffect(() => setPly(readHashPly(max)), [max]);
  const seek = useCallback(
    (p: number) => {
      const next = Math.max(0, Math.min(p, max));
      setPly(next);
      try {
        window.history.replaceState(null, "", `#${next}`);
      } catch {
        // ignore (sandboxed iframes)
      }
    },
    [max],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) ||
          e.target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null)
      ) {
        return;
      }
      const map: Record<string, () => void> = {
        ArrowLeft: () => seek(ply - 1),
        ArrowRight: () => seek(ply + 1),
        ArrowUp: () => seek(0),
        Home: () => seek(0),
        ArrowDown: () => seek(max),
        End: () => seek(max),
        f: () => setOrientation((o) => (o === "white" ? "black" : "white")),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ply, max, seek]);

  useEffect(() => {
    moveList.current
      ?.querySelector<HTMLElement>(`[data-ply="${ply}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ply]);

  const node = nodes[ply] ?? tree.root;
  const pos = positionFromFen(node.fen);
  const lastMove = node.uci ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as Key[]) : undefined;
  const a = game.analysis;
  const classes = (a?.classes ?? []) as MoveClass[];
  const markers: GraphMarker[] = classes.flatMap((c, i) =>
    MARKED.has(c) ? [{ index: i + 1, color: CLASS_META[c].color, label: classLabel(c) }] : [],
  );
  const white = header(tree, "White") ?? t("white");
  const black = header(tree, "Black") ?? t("black");
  const result = header(tree, "Result") ?? "*";
  const event = header(tree, "Event");
  const date = header(tree, "Date") ?? header(tree, "UTCDate");
  const cls = ply > 0 ? classes[ply - 1] : undefined;

  const openIn = (where: "analysis" | "review") => {
    if (where === "analysis") {
      useAnalysis.getState().loadPgn(game.pgn);
      router.push("/analysis");
    } else {
      try {
        useReview.getState().start(game.pgn);
        router.push("/review");
      } catch {
        // Ignore games too short to review (< 2 half-moves).
      }
    }
  };

  const navButtons = (
    <div className="flex items-center justify-center gap-1">
      <Button variant="ghost" size="icon" aria-label={t("first")} onClick={() => seek(0)}>
        <ChevronFirst />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t("previous")} onClick={() => seek(ply - 1)}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t("next")} onClick={() => seek(ply + 1)}>
        <ChevronRight />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t("last")} onClick={() => seek(max)}>
        <ChevronLast />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("flip")}
        onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
      >
        <FlipVertical2 />
      </Button>
    </div>
  );

  const moves = (
    <ol
      ref={moveList}
      aria-label={t("moves")}
      className={cn(
        "grid grid-cols-[2.5rem_1fr_1fr] content-start gap-y-0.5 overflow-y-auto p-2 text-sm",
        embed ? "max-h-full" : "max-h-[min(50vh,28rem)]",
      )}
    >
      {nodes.slice(1).map((n, i) => {
        const p = i + 1;
        const c = classes[i];
        const cell = (
          <button
            key={n.id}
            type="button"
            data-ply={p}
            onClick={() => seek(p)}
            aria-current={p === ply ? "true" : undefined}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-left font-mono hover:bg-accent",
              p === ply && "bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            {c && MARKED.has(c) && <MoveClassBadge cls={c} className="size-4 text-[8px]" />}
            {formatSan(n.san ?? "", notation, colorOfPly(n.ply))}
          </button>
        );
        const number = n.ply % 2 === 1 || i === 0;
        return (
          <li key={n.id} className="contents">
            {number && (
              <span className="py-0.5 text-right font-mono text-xs leading-6 text-muted-foreground">
                {Math.ceil(n.ply / 2)}.
              </span>
            )}
            {n.ply % 2 === 0 && i === 0 && <span />}
            {cell}
          </li>
        );
      })}
    </ol>
  );

  const board = (
    <div className="flex min-w-0 gap-2">
      {a && (
        <EvalBar
          score={undefined}
          whiteWin={a.whiteWin[ply]}
          orientation={orientation}
          className="w-5 shrink-0 sm:w-6"
        />
      )}
      <div className="relative min-w-0 flex-1">
        <ChessBoard
          sound
          fen={node.fen}
          orientation={orientation}
          turnColor={pos.turn}
          lastMove={lastMove}
          check={pos.isCheck()}
          label={t("boardLabel", { white, black })}
        >
          {cls && node.uci && (
            <SquareBadge cls={cls} square={badgeSquare(node.uci, node.san ?? "")} orientation={orientation} />
          )}
        </ChessBoard>
      </div>
    </div>
  );

  if (embed) {
    return (
      <div className="grid h-dvh grid-cols-[minmax(0,1fr)_11rem] gap-2 bg-background p-2 text-foreground">
        <div className="flex min-h-0 flex-col justify-center">
          <div className="mx-auto w-full max-w-[calc(100dvh-4rem)]">{board}</div>
          {navButtons}
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <p className="truncate border-b px-2 py-1.5 text-xs font-medium" title={`${white} – ${black}`}>
            {white} – {black} <span className="text-muted-foreground">{result}</span>
          </p>
          <div className="min-h-0 flex-1">{moves}</div>
          <a
            href={`/g/${game.id}#${ply}`}
            target="_blank"
            rel="noopener"
            className="flex items-center justify-center gap-1 border-t px-2 py-1.5 text-xs text-primary hover:underline"
          >
            {t("openOnKingside")} <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,24rem)]">
      <div className="min-w-0 space-y-2">
        <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-12rem))]">{board}</div>
        {a && <EvalGraph whiteWin={a.whiteWin} index={ply} onSeek={seek} markers={markers} />}
        {navButtons}
      </div>
      <aside className="glass flex min-w-0 flex-col overflow-hidden rounded-2xl">
        <div className="space-y-1 border-b p-4">
          <h1 className="text-lg font-semibold">
            {white} <span className="text-muted-foreground">{t("vs")}</span> {black}
          </h1>
          <p className="text-sm text-muted-foreground">{[result, event, date].filter(Boolean).join(" · ")}</p>
          {a && (a.accuracy.white !== null || a.accuracy.black !== null) && (
            <p className="text-sm">
              {t("accuracy")}: <span className="font-mono">{a.accuracy.white?.toFixed(1) ?? "–"}</span> /{" "}
              <span className="font-mono">{a.accuracy.black?.toFixed(1) ?? "–"}</span>
            </p>
          )}
        </div>
        {moves}
        <div className="mt-auto flex flex-wrap gap-1 border-t p-2">
          <Button variant="ghost" size="sm" onClick={() => openIn("analysis")}>
            <LineChart /> {t("analyze")}
          </Button>
          {nodes.length >= 3 && (
            <Button variant="ghost" size="sm" onClick={() => openIn("review")}>
              <FileSearch /> {t("review")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={saved}
            onClick={async () => {
              const id = await saveGame({
                pgn: game.pgn,
                white,
                black,
                result,
                source: "shared",
                playedAt: Date.now(),
              });
              setSaved(id !== undefined);
            }}
          >
            {saved ? <Check /> : <BookmarkPlus />} {saved ? t("saved") : t("save")}
          </Button>
          <ShareDialog
            target={{
              pgn: game.pgn,
              fens: nodes.map((n) => n.fen),
              moves: nodes.slice(1).map((n) => n.uci ?? ""),
              ply,
              fen: node.fen,
              lastMove: node.uci,
              orientation,
              analysis: a,
              white,
              black,
              date,
            }}
          />
        </div>
      </aside>
    </div>
  );
}
