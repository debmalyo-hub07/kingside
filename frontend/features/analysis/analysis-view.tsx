// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  isTablebasePosition,
  mainlineFrom,
  nodesAlongPath,
  positionFromFen,
  treeToPgn,
} from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import {
  BookmarkPlus,
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  FlipVertical2,
  PencilRuler,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { EvalBar } from "@/components/eval-bar";
import { MoveAnnouncer } from "@/components/move-announcer";
import { MoveInput } from "@/components/move-input";
import { Button } from "@/components/ui/button";
import { useEngineAnalysis } from "@/engine/use-engine-analysis";
import { tablebaseWhiteOutcome, useTablebase } from "@/features/explorer/explorer-data";
import { ExplorerPanel } from "@/features/explorer/explorer-panel";
import { TablebasePanel } from "@/features/explorer/tablebase-panel";
import { useReview } from "@/features/review/review-store";
import { ShareDialog, type ShareTarget } from "@/features/share/share-dialog";
import { saveGame } from "@/lib/local-db";
import { useSettings } from "@/lib/settings-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { usePositionErrorText } from "@/lib/use-position-error";
import { cn } from "@/lib/utils";
import { useAnalysis, useCurrentNode } from "./analysis-store";
import { EnginePanel } from "./engine-panel";
import { LoadDialog } from "./load-dialog";
import { MoveList } from "./move-list";
import { OpeningLabel } from "./opening-label";

const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null)
  );
}

export function AnalysisView({
  initialFen,
  initialPgn,
  initialPanel = "moves",
}: {
  initialFen?: string;
  initialPgn?: string;
  initialPanel?: "moves" | "explorer";
}) {
  const store = useAnalysis();
  const node = useCurrentNode();
  const { engineEnabled, showBestArrow, moveInput, update } = useSettings();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [panel, setPanel] = useState<"moves" | "explorer">(initialPanel);
  // Wide screens show the explorer in its own column, so the side panel always shows the moves.
  const wide = useMediaQuery("(min-width: 1280px)");
  const shownPanel = wide ? "moves" : panel;
  const boardApi = useRef<Api | null>(null);
  const engineRef = useRef<HTMLElement>(null);
  const movesRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = useTranslations("analysis");
  const positionError = usePositionErrorText();

  // Load ?fen= / ?pgn= once.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      if (initialPgn) useAnalysis.getState().loadPgn(initialPgn);
      else if (initialFen) useAnalysis.getState().loadFen(initialFen);
    } catch (e) {
      setLoadError(positionError(e));
    }
  }, [initialFen, initialPgn, positionError]);

  const pos = useMemo(() => positionFromFen(node.fen), [node.fen]);
  const dests = useMemo(() => chessgroundDests(pos) as Map<Key, Key[]>, [pos]);
  const outcome = pos.outcome();
  const gameOver = outcome
    ? pos.isCheckmate()
      ? t(outcome.winner === "white" ? "over.mateWhite" : "over.mateBlack")
      : pos.isStalemate()
        ? t("over.stalemate")
        : t("over.insufficient")
    : null;
  const gameOverWhiteWin = outcome
    ? outcome.winner === "white"
      ? 100
      : outcome.winner === "black"
        ? 0
        : 50
    : undefined;

  const engine = useEngineAnalysis(gameOver ? null : node.fen, engineEnabled);
  const inTablebase = !gameOver && isTablebasePosition(node.fen);
  const tablebase = useTablebase(node.fen, inTablebase);
  const tbOutcome = tablebase.status === "ok" ? tablebaseWhiteOutcome(tablebase.data, node.fen) : null;
  const snapshot = engine.snapshot?.fen === node.fen ? engine.snapshot : null;

  const autoShapes = useMemo<DrawShape[]>(() => {
    if (!engineEnabled || !showBestArrow || !snapshot) return [];
    return snapshot.lines.slice(0, 2).flatMap((line, i) => {
      const uci = line.pv[0];
      if (!uci) return [];
      return [
        {
          orig: uci.slice(0, 2) as Key,
          dest: uci.slice(2, 4) as Key,
          brush: i === 0 ? "paleBlue" : "paleGrey",
          modifiers: { lineWidth: i === 0 ? 12 : 8 },
        },
      ];
    });
  }, [engineEnabled, showBestArrow, snapshot]);

  const lastMove = node.uci ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as Key[]) : undefined;

  const resetBoard = useCallback(() => {
    boardApi.current?.set({ fen: node.fen, lastMove });
  }, [node.fen, lastMove]);

  const onMove = (orig: Key, dest: Key) => {
    const square = parseSquare(orig);
    const piece = square !== undefined ? pos.board.get(square) : undefined;
    const lastRank = pos.turn === "white" ? "8" : "1";
    if (piece?.role === "pawn" && dest[1] === lastRank) {
      setPromotion({ orig, dest });
      return;
    }
    if (!store.playMove(orig + dest)) resetBoard();
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useAnalysis.getState();
      const actions: Record<string, () => void> = {
        ArrowLeft: s.prev,
        ArrowRight: s.next,
        ArrowUp: s.first,
        Home: s.first,
        ArrowDown: s.last,
        End: s.last,
        f: s.flip,
        x: () => update({ engineEnabled: !useSettings.getState().engineEnabled }),
        " ": () => {
          const best = snapshot?.lines[0]?.pv[0];
          if (best) s.playMove(best);
        },
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snapshot, update]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `store.version` tracks in-place tree edits.
  const shareTarget = useMemo<ShareTarget>(() => {
    const line = nodesAlongPath(store.tree, mainlineFrom(store.tree));
    const index = line.findIndex((n) => n.id === node.id);
    const h = (k: string) => store.tree.headers.get(k);
    return {
      pgn: treeToPgn(store.tree),
      fens: line.map((n) => n.fen),
      moves: line.slice(1).map((n) => n.uci ?? ""),
      ply: index >= 0 ? index : null,
      fen: node.fen,
      lastMove: node.uci,
      orientation: store.orientation,
      white: h("White"),
      black: h("Black"),
      date: h("Date") ?? null,
    };
  }, [store.tree, store.version, store.orientation, node]);

  const save = async () => {
    const h = (k: string, d: string) => {
      const v = store.tree.headers.get(k);
      return v && v !== "?" ? v : d;
    };
    const id = await saveGame({
      pgn: shareTarget.pgn,
      white: h("White", t("white")),
      black: h("Black", t("black")),
      result: h("Result", "*"),
      source: "analysis",
      playedAt: Date.now(),
    });
    setSaved(id ?? null);
    setTimeout(() => setSaved(null), 2000);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,25rem)] xl:grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)_minmax(300px,21rem)]">
      {wide && (
        <section
          aria-label={inTablebase ? t("tabs.tablebase") : t("tabs.explorer")}
          className="flex max-h-[calc(100dvh-8rem)] min-w-0 flex-col self-start overflow-hidden rounded-xl border bg-card"
        >
          <h2 className="border-b px-3 py-2 text-sm font-semibold">
            {inTablebase ? t("tabs.tablebase") : t("tabs.explorer")}
          </h2>
          <div className="min-h-40 overflow-y-auto">
            {inTablebase ? (
              <TablebasePanel state={tablebase} ply={node.ply} onPlay={store.playMove} />
            ) : (
              <ExplorerPanel fen={node.fen} ply={node.ply} onPlay={store.playMove} />
            )}
          </div>
        </section>
      )}
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 justify-center gap-2">
          <EvalBar
            score={snapshot?.lines[0]?.score}
            whiteWin={gameOverWhiteWin}
            orientation={store.orientation}
            badge={tbOutcome ? "TB" : undefined}
            badgeTitle={tbOutcome ? t(`tb.${tbOutcome}`) : undefined}
            className="w-6 shrink-0 self-stretch sm:w-7"
          />
          <div className="min-w-0 flex-1 max-w-[min(100%,calc(100dvh-9.5rem),42.5rem)]">
            <ChessBoard
              sound
              fen={node.fen}
              orientation={store.orientation}
              turnColor={pos.turn}
              lastMove={lastMove}
              check={pos.isCheck()}
              dests={promotion ? new Map() : dests}
              autoShapes={autoShapes}
              onMove={onMove}
              onReady={(api) => {
                boardApi.current = api;
              }}
            >
              {promotion && (
                <PromotionPicker
                  color={pos.turn}
                  onPick={(role) => {
                    const ok = store.playMove(promotion.orig + promotion.dest + ROLE_CHAR[role]);
                    setPromotion(null);
                    if (!ok) resetBoard();
                  }}
                  onCancel={() => {
                    setPromotion(null);
                    resetBoard();
                  }}
                />
              )}
            </ChessBoard>
          </div>
        </div>
        <MoveAnnouncer san={node.san} ply={node.ply} extra={gameOver} />
        {moveInput && (
          <MoveInput
            fen={node.fen}
            disabled={!!gameOver}
            onMove={store.playMove}
            className="mx-auto max-w-[min(100%,calc(100dvh-7.25rem),44.75rem)]"
          />
        )}
      </div>

      <nav
        aria-label={t("mobileControls")}
        className="sticky top-[4.25rem] z-20 flex flex-wrap items-center justify-between gap-1 rounded-xl border bg-background/90 px-1.5 py-1.5 shadow-md backdrop-blur-xl min-[390px]:px-2 lg:hidden"
      >
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-9 min-[390px]:w-10"
            aria-label={t("first")}
            onClick={store.first}
          >
            <ChevronFirst />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-9 min-[390px]:w-10"
            aria-label={t("previous")}
            onClick={store.prev}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-9 min-[390px]:w-10"
            aria-label={t("next")}
            onClick={store.next}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-9 min-[390px]:w-10"
            aria-label={t("last")}
            onClick={store.last}
          >
            <ChevronLast />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-9 min-[390px]:w-10"
            aria-label={t("flip")}
            onClick={store.flip}
          >
            <FlipVertical2 />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-10 px-2 text-xs min-[390px]:px-2.5"
            onClick={() => engineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {t("jumpEngine")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="min-h-10 px-2 text-xs min-[390px]:px-2.5"
            onClick={() => {
              setPanel("moves");
              requestAnimationFrame(() =>
                movesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
              );
            }}
          >
            {t("jumpMoves")}
          </Button>
        </div>
      </nav>

      <aside
        ref={engineRef}
        className="flex min-w-0 scroll-mt-32 flex-col overflow-hidden rounded-xl border bg-card"
      >
        {loadError && (
          <p role="alert" className="border-b bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </p>
        )}
        <EnginePanel
          fen={node.fen}
          engine={engine}
          gameOver={gameOver}
          onPlayLine={(ucis) => {
            for (const u of ucis) store.playMove(u);
          }}
        />
        <OpeningLabel />
        {!wide && (
          <div role="tablist" aria-label={t("sidePanel")} className="flex gap-1 border-b px-2 py-1.5">
            {(
              [
                ["moves", t("tabs.moves")],
                ["explorer", inTablebase ? t("tabs.tablebase") : t("tabs.explorer")],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`panel-tab-${id}`}
                aria-selected={panel === id}
                aria-controls={`panel-${id}`}
                onClick={() => setPanel(id)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition",
                  panel === id ? "bg-secondary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div
          ref={movesRef}
          id={`panel-${shownPanel}`}
          {...(wide ? {} : { role: "tabpanel", "aria-labelledby": `panel-tab-${shownPanel}` })}
          className={cn(
            "min-h-40 scroll-mt-32 overflow-y-auto",
            wide ? "max-h-[min(60vh,34rem)]" : "max-h-[min(50vh,28rem)]",
          )}
        >
          {shownPanel === "moves" ? (
            <MoveList />
          ) : inTablebase ? (
            <TablebasePanel state={tablebase} ply={node.ply} onPlay={store.playMove} />
          ) : (
            <ExplorerPanel fen={node.fen} ply={node.ply} onPlay={store.playMove} />
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1 border-t p-2">
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label={t("first")}
            onClick={store.first}
          >
            <ChevronFirst />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label={t("previous")}
            onClick={store.prev}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label={t("next")}
            onClick={store.next}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label={t("last")}
            onClick={store.last}
          >
            <ChevronLast />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label={t("flip")}
            onClick={store.flip}
          >
            <FlipVertical2 />
          </Button>
          {store.path.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("deleteFromHere")}
              title={t("deleteFromHereHint")}
              onClick={() => store.remove(store.path)}
            >
              <Trash2 />
            </Button>
          )}
          <span className="ml-auto" />
          <LoadDialog />
          {mainlineFrom(store.tree).length >= 2 && (
            <Button
              variant="ghost"
              size="sm"
              title={t("reviewHint")}
              onClick={() => {
                try {
                  useReview.getState().start(treeToPgn(store.tree));
                  router.push("/review");
                } catch (e) {
                  setLoadError(positionError(e));
                }
              }}
            >
              <FileSearch /> {t("review")}
            </Button>
          )}
          <ShareDialog target={shareTarget} />
          {store.tree.root.children.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={saved !== null ? t("saved") : t("save")}
              title={saved !== null ? t("saved") : t("save")}
              onClick={save}
            >
              {saved !== null ? <Check /> : <BookmarkPlus />}
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label={t("edit")} asChild>
            <Link href={`/editor?fen=${encodeURIComponent(node.fen)}`}>
              <PencilRuler />
            </Link>
          </Button>
          <BoardSettings />
        </div>
      </aside>
    </div>
  );
}
