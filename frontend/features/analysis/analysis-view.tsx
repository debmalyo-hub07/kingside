// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  clockFromComments,
  type EngineLine,
  isTablebasePosition,
  type MoveClass,
  mainlineFrom,
  nodeAtPath,
  nodeCommentText,
  nodesAlongPath,
  positionFromFen,
  treeToPgn,
  winPercentFromScore,
} from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import {
  BookmarkPlus,
  Brush,
  Check,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Crosshair,
  Eraser,
  FileInput,
  FileSearch,
  FlipVertical2,
  LineChart,
  Maximize2,
  Minimize2,
  Palette,
  Pause,
  PencilRuler,
  Play,
  RotateCcw,
  Share2,
  Swords,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { m } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardModeToggles } from "@/components/board/board-mode-toggles";
import { type BoardInteractionMode, ChessBoard, type DrawBrushColor } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettings } from "@/components/board-settings";
import { EvalBar, formatScore } from "@/components/eval-bar";
import { EvalGraph, type GraphMarker, type GraphPointMeta } from "@/components/eval-graph";
import { MoveAnnouncer } from "@/components/move-announcer";
import { MoveInput } from "@/components/move-input";
import { Button } from "@/components/ui/button";
import { HintTooltip, TooltipProvider } from "@/components/ui/tooltip";
import { ENGINE_NAME, engineLabel } from "@/engine/stockfish-engine";
import {
  NODE_BUDGET_CACHE_ENGINE,
  resolveCachedSearchDepth,
  useEngineAnalysis,
} from "@/engine/use-engine-analysis";
import { useThreatAnalysis } from "@/engine/use-threat-analysis";
import { tablebaseWhiteOutcome, useTablebase } from "@/features/explorer/explorer-data";
import { ExplorerPanel } from "@/features/explorer/explorer-panel";
import { TablebasePanel } from "@/features/explorer/tablebase-panel";
import { Captured } from "@/features/review/material";
import { badgeSquare, CLASS_META, SquareBadge, useClassLabel } from "@/features/review/move-classes";
import { useReview } from "@/features/review/review-store";
import { ShareDialog, type ShareTarget } from "@/features/share/share-dialog";
import { evalKey, getDb, saveGame, withTimeout } from "@/lib/local-db";
import { colorOfPly, formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { usePrefersReducedMotion } from "@/lib/use-in-view";
import { useMediaQuery } from "@/lib/use-media-query";
import { usePositionErrorText } from "@/lib/use-position-error";
import { cn } from "@/lib/utils";
import { ANALYSIS_HOLD_MS, type HeldEval, resolveAnalysisEvalBar } from "./analysis-eval";
import { type AnalysisWorkspace, useAnalysis, useCurrentNode } from "./analysis-store";
import { buildCandidateArrowShapes } from "./candidate-arrows";
import { EnginePanel } from "./engine-panel";
import {
  collectTreeNodes,
  computeTreeClassifications,
  type EvalEntry,
  epdOf,
  isBetterEvalEntry,
  shouldUpdateEvalEntry,
} from "./live-classification";
import { LoadDialog } from "./load-dialog";
import { MoveList } from "./move-list";
import { OpeningLabel } from "./opening-label";
import { ShortcutsGuideDialog, ShortcutsGuideTrigger } from "./shortcuts-guide";

const ROLE_CHAR = { queen: "q", rook: "r", bishop: "b", knight: "n" } as const;
const DRAW_BRUSHES: { id: DrawBrushColor; swatch: string }[] = [
  { id: "green", swatch: "bg-emerald-500" },
  { id: "blue", swatch: "bg-sky-500" },
  { id: "yellow", swatch: "bg-amber-400" },
  { id: "red", swatch: "bg-rose-500" },
];
const START_COUNTS = { queen: 1, rook: 2, bishop: 2, knight: 2, pawn: 8 } as const;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null)
  );
}

function isInteractiveControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      'button, a[href], summary, [role="button"], [role="switch"], [role="tab"], [role="checkbox"], [role="radio"], [role="slider"]',
    ) !== null
  );
}

function hasHeaderValue(val: string | undefined): val is string {
  return Boolean(val && val.trim() !== "" && val.trim() !== "?");
}

function formatClockSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function hasCapturedPieces(fen: string): boolean {
  try {
    const pos = positionFromFen(fen);
    const counts = {
      white: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
      black: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
    };
    for (const [, p] of pos.board) {
      if (p.role !== "king") counts[p.color][p.role]++;
    }
    return (Object.keys(START_COUNTS) as (keyof typeof START_COUNTS)[]).some(
      (r) => counts.white[r] !== START_COUNTS[r] || counts.black[r] !== START_COUNTS[r],
    );
  } catch {
    return false;
  }
}

const MARKED_GRAPH_CLASSES = new Set<MoveClass>([
  "brilliant",
  "great",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
]);

function PlayerPlate({
  color,
  name,
  elo,
  clockSec,
  active,
  fen,
}: {
  color: "white" | "black";
  name: string;
  elo?: string | undefined;
  clockSec: number | null;
  active: boolean;
  fen: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 px-1 py-0.5 text-xs md:py-1 md:text-sm">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "size-2.5 shrink-0 rounded-full border border-border",
            color === "white" ? "bg-[var(--eval-white-bg)]" : "bg-[var(--eval-black-bg)]",
          )}
        />
        <span className="truncate font-medium text-foreground">{name}</span>
        {elo && <span className="shrink-0 text-xs text-muted-foreground">({elo})</span>}
        <Captured fen={fen} color={color} />
      </div>
      {clockSec !== null && (
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums",
            active
              ? "border-primary/40 bg-primary/15 text-foreground"
              : "bg-secondary/70 text-muted-foreground",
          )}
        >
          {formatClockSeconds(clockSec)}
        </span>
      )}
    </div>
  );
}

export function AnalysisView({
  initialFen,
  defaultFen,
  initialPgn,
  initialPanel = "moves",
  persistSession = false,
  sessionKey = "analysis",
}: {
  initialFen?: string;
  defaultFen?: string;
  initialPgn?: string;
  initialPanel?: "moves" | "explorer";
  persistSession?: boolean;
  sessionKey?: AnalysisWorkspace;
}) {
  const store = useAnalysis();
  const node = useCurrentNode();
  const classLabel = useClassLabel();
  const { engineEnabled, showBestArrow, moveInput, notation, analysisNet, update } = useSettings();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [panel, setPanel] = useState<"moves" | "engine" | "explorer" | "pgn">(initialPanel);
  const [copiedPgn, setCopiedPgn] = useState(false);
  const [copiedFen, setCopiedFen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [boardMode, setBoardMode] = useState<BoardInteractionMode>("play");
  const [drawBrush, setDrawBrush] = useState<DrawBrushColor>("green");
  const [drawnCount, setDrawnCount] = useState(0);
  const [clearShapesSignal, setClearShapesSignal] = useState(0);
  const [threatEnabled, setThreatEnabled] = useState(false);
  const [previewUcis, setPreviewUcis] = useState<string[] | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [evalGraphOpen, setEvalGraphOpen] = useState(true);
  const [evalMap, setEvalMap] = useState<Record<string, EvalEntry>>(() => {
    const seeded: Record<string, EvalEntry> = {};
    for (const [epd, lines] of Object.entries(useAnalysis.getState().initialEvals)) {
      if (lines.length > 0) seeded[epd] = { depth: lines[0]?.depth ?? 0, lines };
    }
    return seeded;
  });

  // Wide screens show the explorer in its own column, so the side panel always shows the moves or PGN/notes.
  const wide = useMediaQuery("(min-width: 1280px)");
  const mdUp = useMediaQuery("(min-width: 768px)");
  const activePanel: "moves" | "engine" | "explorer" | "pgn" = mdUp && panel === "engine" ? "moves" : panel;
  const desktopDrawerTab: "moves" | "explorer" | "pgn" =
    panel === "pgn" ? "pgn" : wide ? "moves" : activePanel === "explorer" ? "explorer" : "moves";
  const boardApi = useRef<Api | null>(null);
  const panelScrollerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = useTranslations("analysis");
  const tBoard = useTranslations("board");
  const tShare = useTranslations("share");
  const positionError = usePositionErrorText();
  const reduceMotion = usePrefersReducedMotion();

  const nodeNote = nodeCommentText(node.comments);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync note draft cleanly when active node changes
  useEffect(() => {
    setNoteDraft(nodeNote);
  }, [node.id, nodeNote]);

  // Load ?fen= / ?pgn= when initial props are provided, or restore isolated workspace sessionStorage.
  const loadedKey = useRef<string | null>(null);
  const ingestedVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (initialPgn || initialFen) {
      const key = `${sessionKey}\0${initialPgn ?? ""}\0${initialFen ?? ""}`;
      if (loadedKey.current === key) return;
      loadedKey.current = key;
      setAutoPlay(false);
      setLoadError(null);
      try {
        if (initialPgn) useAnalysis.getState().loadPgn(initialPgn, { persist: persistSession, sessionKey });
        else if (initialFen)
          useAnalysis.getState().loadFen(initialFen, { persist: persistSession, sessionKey });
        ingestedVersionRef.current = useAnalysis.getState().version;
      } catch (e) {
        setLoadError(positionError(e));
      }
      return;
    }
    loadedKey.current = null;
    ingestedVersionRef.current = null;
    if (persistSession) {
      const cur = useAnalysis.getState();
      if (!cur.hasPersistedSession || cur.sessionKey !== sessionKey) {
        const restored = cur.restoreSession(sessionKey);
        if (!restored) {
          cur.loadFen(defaultFen ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", {
            persist: persistSession,
            sessionKey,
          });
        }
      }
    } else if (defaultFen) {
      useAnalysis.getState().loadFen(defaultFen, { persist: false, sessionKey });
    }
  }, [initialFen, defaultFen, initialPgn, persistSession, sessionKey, positionError]);

  // Normalize ?fen= / ?pgn= URLs after initial load or first edit so reloads keep your lines.
  useEffect(() => {
    if (typeof window === "undefined" || (!initialFen && !initialPgn)) return;
    const search = window.location.search;
    if (!search.includes("fen=") && !search.includes("pgn=")) return;
    const normalize = () => {
      if (window.location.search.includes("fen=") || window.location.search.includes("pgn=")) {
        try {
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          // ignore
        }
      }
    };
    if (ingestedVersionRef.current !== null && store.version > ingestedVersionRef.current) {
      normalize();
      return;
    }
    const timer = setTimeout(normalize, 350);
    return () => clearTimeout(timer);
  }, [initialFen, initialPgn, store.version]);

  // Clear stale evalMap whenever a different tree is loaded (re-seeding from initialEvals if present).
  const prevTreeRef = useRef(store.tree);
  useEffect(() => {
    if (prevTreeRef.current === store.tree) return;
    prevTreeRef.current = store.tree;
    const seeded: Record<string, EvalEntry> = {};
    for (const [epd, lines] of Object.entries(useAnalysis.getState().initialEvals)) {
      if (lines.length > 0) seeded[epd] = { depth: lines[0]?.depth ?? 0, lines };
    }
    setEvalMap(seeded);
  }, [store.tree]);

  // Reset transient preview & auto-play when position/tree resets.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear preview whenever current fen changes.
  useEffect(() => {
    setPreviewUcis(null);
  }, [node.fen]);

  const stopAutoPlay = useCallback(() => setAutoPlay(false), []);

  const handleReset = useCallback(() => {
    stopAutoPlay();
    setPromotion(null);
    setSaved(null);
    setPreviewUcis(null);
    setLoadError(null);
    setThreatEnabled(false);
    setBoardMode("play");
    setClearShapesSignal((n) => n + 1);
    useAnalysis.getState().reset({ defaultFen, persist: persistSession, sessionKey });
    if (typeof window !== "undefined") {
      const search = window.location.search;
      if (search.includes("fen=") || search.includes("pgn=")) {
        try {
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          // ignore
        }
      }
    }
  }, [stopAutoPlay, defaultFen, persistSession, sessionKey]);

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

  const engine = useEngineAnalysis(gameOver ? null : node.fen, engineEnabled, store.tree);
  const threat = useThreatAnalysis(gameOver ? null : node.fen, threatEnabled);
  const inTablebase = !gameOver && isTablebasePosition(node.fen);
  const tablebase = useTablebase(node.fen, inTablebase);
  const tbOutcome = tablebase.status === "ok" ? tablebaseWhiteOutcome(tablebase.data, node.fen) : null;
  const snapshot = engine.snapshot?.fen === node.fen ? engine.snapshot : null;

  const heldEvalTreeRef = useRef(store.tree);
  const heldEvalRef = useRef<HeldEval | null>(null);
  if (heldEvalTreeRef.current !== store.tree) {
    heldEvalTreeRef.current = store.tree;
    heldEvalRef.current = null;
  }
  const [holdExpiredForFen, setHoldExpiredForFen] = useState<string | null>(null);
  const holdExpired = holdExpiredForFen === node.fen;

  const evalBarTarget = resolveAnalysisEvalBar({
    gameOverWhiteWin,
    snapshot,
    cachedEntry: evalMap[epdOf(node.fen)],
    reviewWhiteWin: store.reviewWhiteWin[node.id],
    engineEnabled,
    heldEval: heldEvalRef.current,
    holdExpired,
  });
  if (evalBarTarget.settled) {
    heldEvalRef.current = { score: evalBarTarget.score, whiteWin: evalBarTarget.whiteWin };
  }

  useEffect(() => {
    if (evalBarTarget.settled || !engineEnabled) return;
    const timer = setTimeout(() => setHoldExpiredForFen(node.fen), ANALYSIS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [node.fen, evalBarTarget.settled, engineEnabled]);

  const prevPathRef = useRef<string[]>(store.path);
  const isAdjacentStep =
    (store.path.length === prevPathRef.current.length + 1 &&
      prevPathRef.current.every((id, i) => store.path[i] === id)) ||
    (prevPathRef.current.length === store.path.length + 1 &&
      store.path.every((id, i) => prevPathRef.current[i] === id));
  const isBoardJump = store.path.join("/") !== prevPathRef.current.join("/") && !isAdjacentStep;
  useEffect(() => {
    prevPathRef.current = store.path;
  }, [store.path]);

  // Record live engine lines into `evalMap` so EvalGraph and live move classifications stay in sync.
  useEffect(() => {
    if (!snapshot || snapshot.lines.length === 0) return;
    const key = epdOf(snapshot.fen);
    const lines: EngineLine[] = snapshot.lines.map((l) => ({
      pv: l.pv,
      score: l.score,
      depth: l.depth,
    }));
    const entry: EvalEntry = { depth: snapshot.depth, lines };
    setEvalMap((prev) => {
      const existing = prev[key];
      if (!shouldUpdateEvalEntry(existing, entry, snapshot.done)) return prev;
      return { ...prev, [key]: entry };
    });
  }, [snapshot]);

  // Mainline path & nodes for EvalGraph v2, plus full tree nodes for Dexie hydration.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `store.version` tracks in-place tree edits.
  const mainlinePath = useMemo(() => mainlineFrom(store.tree), [store.tree, store.version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `store.version` tracks in-place tree edits.
  const mainlineNodes = useMemo(
    () => nodesAlongPath(store.tree, mainlinePath),
    [store.tree, mainlinePath, store.version],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `store.version` tracks in-place tree edits.
  const allNodes = useMemo(() => collectTreeNodes(store.tree.root), [store.tree, store.version]);

  // Hydrate evalMap from local Dexie cache across all tree nodes (including Match Analysis `|nodes` entries).
  useEffect(() => {
    if (allNodes.length === 0) return;
    let cancelled = false;
    const db = getDb();
    if (!db) return;
    const keys = allNodes.flatMap((n) => [
      { epd: epdOf(n.fen), key: evalKey(n.fen, engineLabel(analysisNet)) },
      { epd: epdOf(n.fen), key: evalKey(n.fen, ENGINE_NAME) },
      { epd: epdOf(n.fen), key: evalKey(n.fen, NODE_BUDGET_CACHE_ENGINE) },
    ]);
    void withTimeout(db.evals.bulkGet(keys.map((k) => k.key)), 1200, []).then((hits) => {
      if (cancelled) return;
      const updates: Record<string, EvalEntry> = {};
      hits.forEach((hit, idx) => {
        const entry = keys[idx];
        if (!hit || !entry || hit.lines.length === 0) return;
        const depth = resolveCachedSearchDepth(hit);
        if (depth <= 0) return;
        const next: EvalEntry = { depth, lines: hit.lines };
        if (isBetterEvalEntry(updates[entry.epd], next)) {
          updates[entry.epd] = next;
        }
      });
      if (Object.keys(updates).length > 0) {
        setEvalMap((prev) => {
          let changed = false;
          const merged = { ...prev };
          for (const [epd, next] of Object.entries(updates)) {
            if (isBetterEvalEntry(merged[epd], next)) {
              merged[epd] = next;
              changed = true;
            }
          }
          return changed ? merged : prev;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [allNodes, analysisNet]);

  // Anchored Match Analysis classifications + live classifications for newly analyzed moves & variations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `store.version` tracks in-place tree edits.
  const nodeClassifications = useMemo(
    () =>
      computeTreeClassifications({
        tree: store.tree,
        reviewClasses: store.reviewClasses,
        evalMap,
      }),
    [store.tree, store.version, store.reviewClasses, evalMap],
  );

  const evalGraphData = useMemo(() => {
    if (mainlinePath.length < 2) return null;
    const whiteWin: number[] = [];
    const meta: (GraphPointMeta | undefined)[] = [];
    const markers: GraphMarker[] = [];
    let lastWin = 50;
    mainlineNodes.forEach((n, idx) => {
      const score = evalMap[epdOf(n.fen)]?.lines[0]?.score;
      const reviewWin = store.reviewWhiteWin[n.id];
      let win = lastWin;
      if (score) {
        win = winPercentFromScore(score);
      } else if (typeof reviewWin === "number") {
        win = reviewWin;
      } else {
        try {
          const p = positionFromFen(n.fen);
          const out = p.outcome();
          if (out) win = out.winner === "white" ? 100 : out.winner === "black" ? 0 : 50;
        } catch {
          // ignore
        }
      }
      lastWin = win;
      whiteWin.push(win);
      if (idx === 0 || !n.san) {
        meta.push(undefined);
      } else {
        const col = colorOfPly(n.ply);
        const cls = nodeClassifications[n.id];
        const sanText = `${Math.ceil(n.ply / 2)}${col === "white" ? "." : "…"} ${formatSan(n.san, notation, col)}`;
        const scoreLabel = score ? formatScore(score) : undefined;
        meta.push({
          san: sanText,
          ...(scoreLabel ? { scoreLabel } : {}),
          ...(cls ? { classification: classLabel(cls) } : {}),
        });
        if (cls && MARKED_GRAPH_CLASSES.has(cls)) {
          markers.push({
            index: idx,
            color: CLASS_META[cls].color,
            ringColor: CLASS_META[cls].ring,
            label: classLabel(cls),
            san: sanText,
            ...(scoreLabel ? { scoreLabel } : {}),
          });
        }
      }
    });
    let activeIdx = 0;
    for (let i = 0; i < mainlinePath.length && i < store.path.length; i++) {
      if (mainlinePath[i] === store.path[i]) activeIdx = i + 1;
      else break;
    }
    return { whiteWin, meta, markers, activeIdx };
  }, [
    mainlinePath,
    mainlineNodes,
    evalMap,
    store.reviewWhiteWin,
    nodeClassifications,
    notation,
    classLabel,
    store.path,
  ]);

  const boardFen = node.fen;
  const boardTurn = pos.turn;
  const boardCheck = pos.isCheck();
  const lastMove = node.uci ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as Key[]) : undefined;

  const autoShapes = useMemo<DrawShape[]>(() => {
    const shapes: DrawShape[] = [];
    const previewArrowUci = previewUcis?.length === 1 ? previewUcis[0] : undefined;
    if (previewArrowUci) {
      shapes.push({
        orig: previewArrowUci.slice(0, 2) as Key,
        dest: previewArrowUci.slice(2, 4) as Key,
        brush: "yellow",
        modifiers: { lineWidth: 11 },
      });
      return shapes;
    }
    const threatShapes: DrawShape[] = [];
    if (threatEnabled && threat.snapshot) {
      const seenThreat = new Set<string>();
      threat.snapshot.lines.slice(0, 2).forEach((line, i) => {
        const uci = line.pv[0];
        if (!uci || uci.length < 4) return;
        const orig = uci.slice(0, 2) as Key;
        const dest = uci.slice(2, 4) as Key;
        const key = `${orig}:${dest}`;
        if (seenThreat.has(key)) return;
        seenThreat.add(key);
        threatShapes.push({
          orig,
          dest,
          brush: "threatCrimson",
          modifiers: { lineWidth: i === 0 ? 11 : 7 },
        });
      });
      shapes.push(...threatShapes);
    }
    if (engineEnabled && showBestArrow && snapshot && !gameOver) {
      shapes.push(
        ...buildCandidateArrowShapes({
          lines: snapshot.lines,
          turn: pos.turn,
          orientation: store.orientation,
          extraShapes: threatShapes,
        }),
      );
    }
    return shapes;
  }, [
    previewUcis,
    threatEnabled,
    threat.snapshot,
    engineEnabled,
    showBestArrow,
    snapshot,
    gameOver,
    pos.turn,
    store.orientation,
  ]);

  // PGN player plates & clocks.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `store.version` tracks in-place tree edits.
  const playerContext = useMemo(() => {
    const h = (k: string) => store.tree.headers.get(k);
    const whiteName = h("White");
    const blackName = h("Black");
    const whiteElo = h("WhiteElo");
    const blackElo = h("BlackElo");
    let whiteClock: number | null = null;
    let blackClock: number | null = null;
    for (const n of nodesAlongPath(store.tree, store.path)) {
      if (n.ply <= 0) continue;
      const clk = clockFromComments(n.comments);
      if (clk === null) continue;
      if (n.ply % 2 === 1) whiteClock = clk;
      else blackClock = clk;
    }
    const captures = hasCapturedPieces(boardFen);
    const visible =
      hasHeaderValue(whiteName) ||
      hasHeaderValue(blackName) ||
      hasHeaderValue(whiteElo) ||
      hasHeaderValue(blackElo) ||
      whiteClock !== null ||
      blackClock !== null ||
      captures;
    return {
      visible,
      white: {
        name: hasHeaderValue(whiteName) ? whiteName : t("white"),
        elo: hasHeaderValue(whiteElo) ? whiteElo : undefined,
        clock: whiteClock,
      },
      black: {
        name: hasHeaderValue(blackName) ? blackName : t("black"),
        elo: hasHeaderValue(blackElo) ? blackElo : undefined,
        clock: blackClock,
      },
    };
  }, [store.tree, store.version, store.path, boardFen, t]);

  // Auto-Play stepping along current continuation; any external tree/path interaction stops it cleanly.
  const autoSteppingRef = useRef(false);
  useEffect(() => {
    if (!autoPlay) {
      autoSteppingRef.current = false;
      return;
    }
    const s0 = useAnalysis.getState();
    const cur0 = nodeAtPath(s0.tree, s0.path);
    if (!cur0 || cur0.children.length === 0) {
      setAutoPlay(false);
      return;
    }
    const id = setInterval(() => {
      const s = useAnalysis.getState();
      const cur = nodeAtPath(s.tree, s.path);
      if (!cur || cur.children.length === 0) {
        setAutoPlay(false);
        return;
      }
      autoSteppingRef.current = true;
      s.next();
    }, 950);
    return () => clearInterval(id);
  }, [autoPlay]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel Auto-Play whenever path/version changes outside the timer.
  useEffect(() => {
    if (!autoPlay) return;
    if (autoSteppingRef.current) {
      autoSteppingRef.current = false;
      return;
    }
    setAutoPlay(false);
  }, [store.path, store.version]);

  const resetBoard = useCallback(() => {
    boardApi.current?.set({ fen: node.fen, lastMove });
  }, [node.fen, lastMove]);

  const onMove = (orig: Key, dest: Key) => {
    stopAutoPlay();
    const square = parseSquare(orig);
    const piece = square !== undefined ? pos.board.get(square) : undefined;
    const lastRank = pos.turn === "white" ? "8" : "1";
    if (piece?.role === "pawn" && dest[1] === lastRank) {
      setPromotion({ orig, dest });
      return;
    }
    if (!store.playMove(orig + dest)) resetBoard();
  };

  // Keyboard shortcuts (Option 1: x=Threat, l=Engine, Space=Best Move, f=Flip, ?=Guide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " && isInteractiveControl(e.target)) return;
      const s = useAnalysis.getState();
      const actions: Record<string, () => void> = {
        ArrowLeft: () => {
          stopAutoPlay();
          s.prev();
        },
        ArrowRight: () => {
          stopAutoPlay();
          s.next();
        },
        ArrowUp: () => {
          stopAutoPlay();
          s.first();
        },
        Home: () => {
          stopAutoPlay();
          s.first();
        },
        ArrowDown: () => {
          stopAutoPlay();
          s.last();
        },
        End: () => {
          stopAutoPlay();
          s.last();
        },
        f: s.flip,
        F: s.flip,
        x: () => setThreatEnabled((v) => !v),
        X: () => setThreatEnabled((v) => !v),
        l: () => update({ engineEnabled: !useSettings.getState().engineEnabled }),
        L: () => update({ engineEnabled: !useSettings.getState().engineEnabled }),
        "?": () => setGuideOpen((v) => !v),
        Escape: () => {
          if (previewUcis) setPreviewUcis(null);
          else if (focusMode) setFocusMode(false);
        },
        " ": () => {
          stopAutoPlay();
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
  }, [snapshot, update, stopAutoPlay, previewUcis, focusMode]);

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

  const bestMoveUci = snapshot?.lines[0]?.pv[0];
  const currentNodeClass = node.uci ? nodeClassifications[node.id] : undefined;
  const topSide = store.orientation === "white" ? "black" : "white";
  const bottomSide = store.orientation;

  const drawBrushBar = (boardMode === "draw" || drawnCount > 0) && (
    <div
      role="toolbar"
      aria-label={tBoard("brush")}
      className="mx-auto flex w-fit flex-wrap items-center justify-center gap-1.5 rounded-full border bg-card/90 px-2.5 py-1 shadow-xs backdrop-blur-md"
    >
      {DRAW_BRUSHES.map((b) => (
        <button
          key={b.id}
          type="button"
          aria-label={tBoard(`brushes.${b.id}`)}
          title={tBoard(`brushes.${b.id}`)}
          aria-pressed={drawBrush === b.id}
          onClick={() => {
            setDrawBrush(b.id);
            if (boardMode !== "draw") setBoardMode("draw");
          }}
          className={cn(
            "grid size-6 place-items-center rounded-full transition",
            drawBrush === b.id
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
              : "opacity-75 hover:opacity-100",
          )}
        >
          <span className={cn("size-3.5 rounded-full", b.swatch)} />
        </button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        disabled={drawnCount === 0}
        aria-label={tBoard("clearShapes")}
        title={tBoard("clearShapesHint")}
        onClick={() => setClearShapesSignal((n) => n + 1)}
      >
        <Eraser className="size-3.5" />
        <span>{tBoard("clearShapes")}</span>
      </Button>
      {boardMode === "draw" && (
        <Button
          variant="secondary"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setBoardMode("play")}
        >
          {tBoard("doneDrawing")}
        </Button>
      )}
    </div>
  );

  const evalGraphBlock = evalGraphData && (
    <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-20.5rem))] md:max-w-[min(100%,calc(100dvh-9.5rem),42.5rem)]">
      <div className="flex items-center justify-between px-1 pb-0.5">
        <button
          type="button"
          aria-expanded={evalGraphOpen}
          onClick={() => setEvalGraphOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <LineChart className="size-3.5 text-primary" aria-hidden />
          <span>{t("evalGraphToggle")}</span>
          {evalGraphOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>
      {evalGraphOpen && (
        <EvalGraph
          whiteWin={evalGraphData.whiteWin}
          index={evalGraphData.activeIdx}
          onSeek={(idx) => {
            stopAutoPlay();
            store.goTo(mainlinePath.slice(0, idx));
          }}
          markers={evalGraphData.markers}
          meta={evalGraphData.meta}
          compact
        />
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden md:grid md:flex-initial md:gap-4 md:overflow-visible",
          focusMode
            ? "md:flex md:flex-col md:items-center"
            : "lg:grid-cols-[minmax(0,1fr)_minmax(320px,25rem)] xl:grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)_minmax(300px,21rem)]",
        )}
      >
        {wide && !focusMode && (
          <section
            aria-label={inTablebase ? t("tabs.tablebase") : t("tabs.explorer")}
            className="flex max-h-[calc(100dvh-8rem)] min-w-0 flex-col self-start overflow-hidden rounded-xl border bg-card"
          >
            <h2 className="border-b px-3 py-2 text-sm font-semibold">
              {inTablebase ? t("tabs.tablebase") : t("tabs.explorer")}
            </h2>
            <div className="min-h-40 overflow-y-auto">
              {inTablebase ? (
                <TablebasePanel
                  state={tablebase}
                  ply={node.ply}
                  onPlay={(u) => {
                    stopAutoPlay();
                    store.playMove(u);
                  }}
                  onPreviewMove={setPreviewUcis}
                />
              ) : (
                <ExplorerPanel
                  fen={node.fen}
                  ply={node.ply}
                  onPlay={(u) => {
                    stopAutoPlay();
                    store.playMove(u);
                  }}
                  onPreviewMove={setPreviewUcis}
                />
              )}
            </div>
          </section>
        )}

        <div className={cn("min-w-0 shrink-0 space-y-1.5 md:space-y-2", focusMode && "w-full")}>
          <div className="flex min-w-0 justify-center gap-1.5 md:gap-2">
            <EvalBar
              score={evalBarTarget.score}
              whiteWin={evalBarTarget.whiteWin}
              orientation={store.orientation}
              badge={tbOutcome ? "TB" : undefined}
              badgeTitle={tbOutcome ? t(`tb.${tbOutcome}`) : undefined}
              className="w-6 shrink-0 self-stretch sm:w-7"
            />
            <div
              className={cn(
                "min-w-0 flex-1 space-y-1",
                focusMode
                  ? "max-w-[min(100%,calc(100dvh-20.5rem))] md:max-w-[min(100%,calc(100dvh-13rem),48rem)]"
                  : "max-w-[min(100%,calc(100dvh-20.5rem))] md:max-w-[min(100%,calc(100dvh-9.5rem),42.5rem)]",
              )}
            >
              {playerContext.visible && (
                <PlayerPlate
                  color={topSide}
                  name={playerContext[topSide].name}
                  elo={playerContext[topSide].elo}
                  clockSec={playerContext[topSide].clock}
                  active={!gameOver && boardTurn === topSide}
                  fen={boardFen}
                />
              )}
              <div className="relative">
                <ChessBoard
                  sound
                  fen={boardFen}
                  orientation={store.orientation}
                  turnColor={boardTurn}
                  lastMove={lastMove}
                  check={boardCheck}
                  dests={promotion ? new Map() : dests}
                  autoShapes={autoShapes}
                  animationMs={isBoardJump ? 0 : undefined}
                  interactionMode={promotion ? "play" : boardMode}
                  drawBrush={drawBrush}
                  clearShapesSignal={clearShapesSignal}
                  onShapesChange={(shapes) => setDrawnCount(shapes.length)}
                  onSwipe={(dir) => {
                    stopAutoPlay();
                    if (dir === "next") store.next();
                    else store.prev();
                  }}
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
                  {!promotion && currentNodeClass && node.uci && (
                    <SquareBadge
                      cls={currentNodeClass}
                      square={badgeSquare(node.uci, node.san ?? "")}
                      orientation={store.orientation}
                    />
                  )}
                </ChessBoard>
              </div>
              {playerContext.visible && (
                <PlayerPlate
                  color={bottomSide}
                  name={playerContext[bottomSide].name}
                  elo={playerContext[bottomSide].elo}
                  clockSec={playerContext[bottomSide].clock}
                  active={!gameOver && boardTurn === bottomSide}
                  fen={boardFen}
                />
              )}
            </div>
          </div>

          {drawBrushBar}

          {/* Focus Mode compact desktop bar */}
          {focusMode && (
            <div className="hidden items-center justify-center gap-1 rounded-xl border bg-card/90 px-2 py-1 shadow-sm backdrop-blur md:flex md:mx-auto md:w-fit">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("first")}
                onClick={() => {
                  stopAutoPlay();
                  store.first();
                }}
              >
                <ChevronFirst />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("previous")}
                onClick={() => {
                  stopAutoPlay();
                  store.prev();
                }}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={autoPlay ? t("pauseAutoPlay") : t("autoPlay")}
                aria-pressed={autoPlay}
                disabled={!autoPlay && node.children.length === 0}
                onClick={() => setAutoPlay((v) => !v)}
              >
                {autoPlay ? <Pause /> : <Play />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("next")}
                onClick={() => {
                  stopAutoPlay();
                  store.next();
                }}
              >
                <ChevronRight />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("last")}
                onClick={() => {
                  stopAutoPlay();
                  store.last();
                }}
              >
                <ChevronLast />
              </Button>
              <Button variant="ghost" size="icon" aria-label={t("flip")} onClick={store.flip}>
                <FlipVertical2 />
              </Button>
              <Button
                variant={threatEnabled ? "secondary" : "ghost"}
                size="icon"
                aria-label={t("threatMode")}
                aria-pressed={threatEnabled}
                onClick={() => setThreatEnabled((v) => !v)}
              >
                <Crosshair className={cn(threatEnabled && "text-destructive")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={tBoard("drawMode")}
                aria-pressed={boardMode === "draw"}
                onClick={() => setBoardMode((m) => (m === "draw" ? "play" : "draw"))}
              >
                <Brush />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="ml-1 gap-1.5"
                aria-label={t("exitFocusMode")}
                onClick={() => setFocusMode(false)}
              >
                <Minimize2 className="size-3.5" />
                {t("exitFocusMode")}
              </Button>
            </div>
          )}

          <div className="hidden lg:block">{evalGraphBlock}</div>

          <MoveAnnouncer san={node.san} ply={node.ply} extra={gameOver} />
          {moveInput && (
            <MoveInput
              fen={node.fen}
              disabled={!!gameOver}
              onMove={(u) => {
                stopAutoPlay();
                return store.playMove(u);
              }}
              className="mx-auto max-w-[min(100%,calc(100dvh-7.25rem),44.75rem)]"
            />
          )}
        </div>

        <nav
          aria-label={t("mobileControls")}
          className="flex shrink-0 flex-nowrap items-center gap-0.5 rounded-xl border bg-card/90 p-1 shadow-sm backdrop-blur-xl lg:hidden"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("first")}
            onClick={() => {
              stopAutoPlay();
              store.first();
            }}
          >
            <ChevronFirst />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("previous")}
            onClick={() => {
              stopAutoPlay();
              store.prev();
            }}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("next")}
            onClick={() => {
              stopAutoPlay();
              store.next();
            }}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("last")}
            onClick={() => {
              stopAutoPlay();
              store.last();
            }}
          >
            <ChevronLast />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 min-w-0 flex-1 px-0"
            aria-label={t("flip")}
            onClick={store.flip}
          >
            <FlipVertical2 />
          </Button>
          <BoardModeToggles
            mode={boardMode}
            onModeChange={setBoardMode}
            buttonClassName="h-10 min-w-0 flex-1 px-0"
          />
        </nav>

        <div className="shrink-0 lg:hidden">{evalGraphBlock}</div>

        <aside
          className={cn(
            "panel-solid flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl md:flex-initial md:max-h-[calc(100dvh-8rem)]",
            focusMode && "md:hidden",
          )}
        >
          {loadError && (
            <p role="alert" className="border-b bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </p>
          )}
          <div className="flex shrink-0 items-center justify-between gap-1 border-b px-2 py-1">
            <div role="tablist" aria-label={t("sidePanel")} className="flex min-w-0 gap-1 overflow-x-auto">
              {(
                [
                  ["moves", t("tabs.moves"), ""],
                  ["engine", t("tabs.engine"), "md:hidden"],
                  ["explorer", inTablebase ? t("tabs.tablebase") : t("tabs.explorer"), "xl:hidden"],
                  ["pgn", t("tabs.pgn"), ""],
                ] as const
              ).map(([id, label, vis]) => {
                const selected =
                  id === "moves"
                    ? desktopDrawerTab === "moves" && activePanel !== "engine"
                    : id === "explorer"
                      ? desktopDrawerTab === "explorer"
                      : activePanel === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`panel-tab-${id}`}
                    aria-selected={selected}
                    aria-controls={selected ? `panel-${id}` : undefined}
                    onClick={() => setPanel(id)}
                    className={cn(
                      "relative shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition md:text-sm",
                      vis,
                      selected
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                    {selected && (
                      <m.span
                        layoutId={reduceMotion ? undefined : "analysis-tab-pill"}
                        aria-hidden
                        transition={{ type: "spring", stiffness: 520, damping: 38 }}
                        className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 md:hidden">
              <Button
                variant={threatEnabled ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                aria-label={t("threatMode")}
                aria-pressed={threatEnabled}
                onClick={() => setThreatEnabled((v) => !v)}
              >
                <Crosshair className={cn("size-4", threatEnabled && "text-destructive")} />
              </Button>
            </div>
          </div>

          <OpeningLabel />

          <div
            id={panel === "engine" ? "panel-engine" : undefined}
            {...(panel === "engine" ? { role: "tabpanel", "aria-labelledby": "panel-tab-engine" } : {})}
            className={cn(
              panel === "engine"
                ? "min-h-0 flex-1 overflow-y-auto md:flex-initial md:overflow-visible"
                : "hidden md:block",
            )}
          >
            <EnginePanel
              fen={node.fen}
              engine={engine}
              gameOver={gameOver}
              onPlayLine={(ucis) => {
                stopAutoPlay();
                for (const u of ucis) {
                  if (!store.playMove(u)) break;
                }
              }}
              threatEnabled={threatEnabled}
              onThreatChange={setThreatEnabled}
              threatSnapshot={threat.snapshot}
              threatTargetFen={threat.targetFen}
              threatUnavailableInCheck={threat.unavailableInCheck}
            />
          </div>

          <div
            ref={panelScrollerRef}
            id={activePanel !== "engine" ? `panel-${desktopDrawerTab}` : undefined}
            {...(activePanel !== "engine"
              ? { role: "tabpanel", "aria-labelledby": `panel-tab-${desktopDrawerTab}` }
              : {})}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto md:min-h-12",
              activePanel === "engine" && "max-md:hidden",
            )}
          >
            {desktopDrawerTab === "pgn" ? (
              <div className="space-y-3 p-3 text-xs">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-muted-foreground">{t("pgnTab.pgn")}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(treeToPgn(store.tree));
                          setCopiedPgn(true);
                          setTimeout(() => setCopiedPgn(false), 1500);
                        } catch {
                          setCopiedPgn(false);
                        }
                      }}
                      className="inline-flex min-h-6 items-center gap-1 rounded-md border bg-secondary/70 px-2 py-0.5 font-medium transition hover:border-primary/40"
                    >
                      {copiedPgn ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
                      {copiedPgn ? t("pgnTab.copied") : t("pgnTab.copyPgn")}
                    </button>
                  </div>
                  <pre className="surface-well max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-xl p-2 font-mono text-[11px] leading-relaxed">
                    {treeToPgn(store.tree)}
                  </pre>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-muted-foreground">{t("pgnTab.fen")}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(node.fen);
                          setCopiedFen(true);
                          setTimeout(() => setCopiedFen(false), 1500);
                        } catch {
                          setCopiedFen(false);
                        }
                      }}
                      className="inline-flex min-h-6 items-center gap-1 rounded-md border bg-secondary/70 px-2 py-0.5 font-medium transition hover:border-primary/40"
                    >
                      {copiedFen ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
                      {copiedFen ? t("pgnTab.copied") : t("pgnTab.copyFen")}
                    </button>
                  </div>
                  <p className="surface-well overflow-x-auto whitespace-nowrap rounded-xl px-2.5 py-1.5 font-mono text-[11px]">
                    {node.fen}
                  </p>
                </div>

                <form
                  className="space-y-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    store.setComment(store.path, noteDraft.trim());
                  }}
                >
                  <label htmlFor="analysis-inline-note" className="block font-medium text-muted-foreground">
                    {node.san
                      ? t("pgnTab.note", {
                          move: formatSan(node.san, notation, node.ply % 2 === 1 ? "white" : "black"),
                        })
                      : t("pgnTab.noteStart")}
                  </label>
                  <textarea
                    id="analysis-inline-note"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    placeholder={t("pgnTab.notePlaceholder")}
                    className="w-full resize-y rounded-xl border bg-surface-well p-2 text-xs outline-none transition focus:border-primary"
                  />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" variant="secondary">
                      {t("pgnTab.saveNote")}
                    </Button>
                  </div>
                </form>
              </div>
            ) : desktopDrawerTab === "moves" ? (
              <MoveList
                scrollContainerRef={panelScrollerRef}
                scrollTrigger={activePanel}
                classifications={nodeClassifications}
              />
            ) : inTablebase ? (
              <TablebasePanel
                state={tablebase}
                ply={node.ply}
                onPlay={(u) => {
                  stopAutoPlay();
                  store.playMove(u);
                }}
                onPreviewMove={setPreviewUcis}
              />
            ) : (
              <ExplorerPanel
                fen={node.fen}
                ply={node.ply}
                onPlay={(u) => {
                  stopAutoPlay();
                  store.playMove(u);
                }}
                onPreviewMove={setPreviewUcis}
              />
            )}
          </div>

          {/* Clean 2-Zone Analysis Toolbar */}
          <div className="mt-auto shrink-0 border-t p-1.5 md:p-2">
            {/* Zone 1: Transport + Reset (desktop lg+) */}
            <div className="mb-1.5 hidden items-center gap-0.5 border-b pb-1.5 lg:flex">
              <HintTooltip label={t("first")} shortcut="↑">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("first")}
                  onClick={() => {
                    stopAutoPlay();
                    store.first();
                  }}
                >
                  <ChevronFirst />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("previous")} shortcut="←">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("previous")}
                  onClick={() => {
                    stopAutoPlay();
                    store.prev();
                  }}
                >
                  <ChevronLeft />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("next")} shortcut="→">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("next")}
                  onClick={() => {
                    stopAutoPlay();
                    store.next();
                  }}
                >
                  <ChevronRight />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("last")} shortcut="↓">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("last")}
                  onClick={() => {
                    stopAutoPlay();
                    store.last();
                  }}
                >
                  <ChevronLast />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("flip")} shortcut="F">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("flip")}
                  onClick={store.flip}
                >
                  <FlipVertical2 />
                </Button>
              </HintTooltip>
              <HintTooltip label={t("reset")} description={t("resetHint")}>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8 gap-1.5 px-2.5 text-xs"
                  onClick={handleReset}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  <span>{t("reset")}</span>
                </Button>
              </HintTooltip>
            </div>

            {/* Zone 2: Primary Labeled Actions + Tools Menu + Single-Icon Shortcuts */}
            <div className="flex items-center gap-1 max-md:flex-nowrap max-md:overflow-x-auto md:flex-wrap md:gap-1.5">
              <HintTooltip label={t("reset")} description={t("resetHint")}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-xs lg:hidden"
                  onClick={handleReset}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  <span>{t("reset")}</span>
                </Button>
              </HintTooltip>
              {autoPlay && (
                <HintTooltip label={t("pauseAutoPlay")} description={t("autoPlayHint")}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0 gap-1 px-2 text-xs"
                    aria-pressed
                    onClick={() => setAutoPlay(false)}
                  >
                    <Pause className="size-3.5" aria-hidden />
                    <span>{t("pauseAutoPlay")}</span>
                  </Button>
                </HintTooltip>
              )}
              <HintTooltip label={t("bestMove")} shortcut="Space" description={t("bestMoveHint")}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden h-8 shrink-0 gap-1 px-2 text-xs md:inline-flex"
                  disabled={!bestMoveUci || !!gameOver}
                  onClick={() => {
                    stopAutoPlay();
                    if (bestMoveUci) store.playMove(bestMoveUci);
                  }}
                >
                  <Zap className="size-3.5" aria-hidden />
                  <span>{t("bestMove")}</span>
                </Button>
              </HintTooltip>
              <HintTooltip label={tBoard("drawMode")} description={tBoard("drawModeHint")}>
                <Button
                  variant={boardMode === "draw" ? "secondary" : "ghost"}
                  size="sm"
                  className="hidden h-8 shrink-0 gap-1 px-2 text-xs lg:inline-flex"
                  aria-pressed={boardMode === "draw"}
                  onClick={() => setBoardMode((m) => (m === "draw" ? "play" : "draw"))}
                >
                  <Brush className="size-3.5" aria-hidden />
                  <span>{t("draw")}</span>
                </Button>
              </HintTooltip>
              <HintTooltip
                label={t("matchAnalysis")}
                description={mainlinePath.length < 2 ? t("matchAnalysisNeedMoves") : t("reviewHint")}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-xs"
                  disabled={mainlinePath.length < 2}
                  onClick={() => {
                    try {
                      useReview.getState().start(treeToPgn(store.tree));
                      router.push("/review");
                    } catch (e) {
                      setLoadError(positionError(e));
                    }
                  }}
                >
                  <FileSearch className="size-3.5" aria-hidden />
                  <span>{t("matchAnalysis")}</span>
                </Button>
              </HintTooltip>
              {!gameOver && (
                <HintTooltip label={t("playVsBot")} description={t("practiceHereHint")}>
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" asChild>
                    <Link href={`/play?fen=${encodeURIComponent(node.fen)}`}>
                      <Swords className="size-3.5" aria-hidden />
                      <span>{t("playVsBot")}</span>
                    </Link>
                  </Button>
                </HintTooltip>
              )}
              <HintTooltip label={tShare("button")} description={tShare("hint")}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-xs"
                  onClick={() => setShareOpen(true)}
                >
                  <Share2 className="size-3.5" aria-hidden />
                  <span>{tShare("button")}</span>
                </Button>
              </HintTooltip>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <DropdownMenu.Root>
                  <HintTooltip label={t("tools")} description={t("toolsHint")}>
                    <DropdownMenu.Trigger asChild>
                      <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs">
                        <Wrench className="size-3.5" aria-hidden />
                        <span>{t("tools")}</span>
                        <ChevronDown className="size-3 opacity-70" aria-hidden />
                      </Button>
                    </DropdownMenu.Trigger>
                  </HintTooltip>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      side="top"
                      sideOffset={6}
                      collisionPadding={8}
                      className="z-50 max-h-[calc(var(--radix-dropdown-menu-content-available-height)-8px)] min-w-52 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
                    >
                      <DropdownMenu.Label className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("toolsGroups.game")}
                      </DropdownMenu.Label>
                      <DropdownMenu.Item
                        onSelect={() => setLoadOpen(true)}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[highlighted]:bg-accent"
                      >
                        <FileInput className="size-3.5 text-muted-foreground" aria-hidden />
                        {t("load.button")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        asChild
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[highlighted]:bg-accent"
                      >
                        <Link href={`/editor?fen=${encodeURIComponent(node.fen)}`}>
                          <PencilRuler className="size-3.5 text-muted-foreground" aria-hidden />
                          {t("edit")}
                        </Link>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={store.tree.root.children.length === 0}
                        onSelect={() => void save()}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-accent"
                      >
                        {saved !== null ? (
                          <Check className="size-3.5 text-primary" aria-hidden />
                        ) : (
                          <BookmarkPlus className="size-3.5 text-muted-foreground" aria-hidden />
                        )}
                        {saved !== null ? t("saved") : t("save")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={store.path.length === 0}
                        onSelect={() => {
                          stopAutoPlay();
                          store.remove(store.path);
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-destructive outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        {t("deleteFromHere")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="my-1 h-px bg-border" />
                      <DropdownMenu.Label className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("toolsGroups.view")}
                      </DropdownMenu.Label>
                      <DropdownMenu.Item
                        disabled={!autoPlay && node.children.length === 0}
                        onSelect={() => setAutoPlay((v) => !v)}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-accent"
                      >
                        {autoPlay ? (
                          <Pause className="size-3.5 text-muted-foreground" aria-hidden />
                        ) : (
                          <Play className="size-3.5 text-muted-foreground" aria-hidden />
                        )}
                        {autoPlay ? t("pauseAutoPlay") : t("autoPlay")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() => setFocusMode((v) => !v)}
                        className="hidden cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[highlighted]:bg-accent md:flex"
                      >
                        <Maximize2 className="size-3.5 text-muted-foreground" aria-hidden />
                        {t("focusMode")}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() => setBoardSettingsOpen(true)}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[highlighted]:bg-accent"
                      >
                        <Palette className="size-3.5 text-muted-foreground" aria-hidden />
                        {tBoard("title")}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                <ShortcutsGuideTrigger onClick={() => setGuideOpen(true)} className="size-8 shrink-0" />
              </div>
            </div>
          </div>
        </aside>
        <LoadDialog open={loadOpen} onOpenChange={setLoadOpen} trigger={null} />
        <BoardSettings open={boardSettingsOpen} onOpenChange={setBoardSettingsOpen} trigger={null} />
        <ShareDialog target={shareTarget} open={shareOpen} onOpenChange={setShareOpen} trigger={null} />
        <ShortcutsGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
      </div>
    </TooltipProvider>
  );
}
