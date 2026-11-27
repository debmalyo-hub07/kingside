// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { DrawShape } from "chessground/draw";
import type { Color, Dests, Key } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "./board.css";
import { useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { boardTheme } from "@/lib/board-themes";
import { pieceSetCssVars } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";
import { moveSoundFor, playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { BOARD_DRAW_BRUSHES } from "./board-brushes";

export type BoardInteractionMode = "play" | "swipe" | "draw";
export type DrawBrushColor = "green" | "blue" | "yellow" | "red";

export interface ChessBoardProps {
  fen: string;
  orientation: Color;
  turnColor?: Color;
  lastMove?: Key[];
  check?: boolean;
  /** Legal destinations; omit for a read-only board. */
  dests?: Dests;
  /** Which color can move/premove on an interactive board (defaults to turnColor). */
  movableColor?: Color | "both";
  /** Allow queueing premoves while waiting for the opponent's turn. */
  premovable?: boolean;
  /** Editor mode: pieces move anywhere, dropped off the board = deleted. */
  free?: boolean;
  autoShapes?: DrawShape[];
  /** Mobile/touch helper mode: normal piece play, horizontal swipe stepping, or pencil arrow/circle drawing. */
  interactionMode?: BoardInteractionMode;
  /** Active brush color when drawing in Pencil Draw Mode. */
  drawBrush?: DrawBrushColor;
  /** Incrementing signal to clear all user-drawn shapes on the board. */
  clearShapesSignal?: number;
  /** Notifies parent when user-drawn shapes change. */
  onShapesChange?: (shapes: DrawShape[]) => void;
  onSwipe?: (direction: "prev" | "next") => void;
  onMove?: (orig: Key, dest: Key) => void;
  /** Editor mode: called after any change to the pieces. */
  onChange?: (api: Api) => void;
  onReady?: (api: Api) => void;
  /** Play a move sound whenever the shown position changes by a move. */
  sound?: boolean;
  /** Accessible name of the board (defaults to the translated "Chess board"). */
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ChessBoard(props: ChessBoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const syncLayersRef = useRef<() => void>(() => {});
  // Latest callbacks without re-creating chessground.
  const handlers = useRef(props);
  handlers.current = props;

  const { boardTheme: themeId, pieceSet, coordinates, animationMs } = useSettings();
  const t = useTranslations("board");
  const theme = boardTheme(themeId);

  const config = useMemo<Config>(() => {
    const interactive = props.free || props.dests !== undefined;
    return {
      fen: props.fen,
      orientation: props.orientation,
      turnColor: props.turnColor ?? "white",
      lastMove: props.lastMove,
      check: props.check ?? false,
      coordinates,
      animation: { enabled: animationMs > 0, duration: animationMs },
      // Never viewOnly: chessground binds input handlers only at creation, so a board that starts
      // read-only could never become interactive. Read-only = nothing movable instead.
      viewOnly: false,
      movable: props.free
        ? { free: true, color: "both", showDests: false }
        : {
            free: false,
            color: interactive ? (props.movableColor ?? props.turnColor ?? "white") : undefined,
            dests: props.dests ?? new Map(),
            showDests: true,
          },
      selectable: { enabled: interactive },
      draggable: { enabled: interactive, deleteOnDropOff: !!props.free },
      premovable: props.premovable ? { enabled: true, showDests: true, castle: true } : { enabled: false },
      highlight: { lastMove: true, check: true },
      drawable: {
        enabled: true,
        autoShapes: props.autoShapes ?? [],
        brushes: BOARD_DRAW_BRUSHES,
        onChange: (shapes) => handlers.current.onShapesChange?.(shapes),
      },
    };
  }, [
    props.fen,
    props.orientation,
    props.turnColor,
    props.lastMove,
    props.check,
    props.dests,
    props.movableColor,
    props.premovable,
    props.free,
    props.autoShapes,
    coordinates,
    animationMs,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: created once; later prop changes go through api.set below.
  useEffect(() => {
    if (!el.current) return;
    const root = el.current;
    const instance = Chessground(root, {
      ...config,
      movable: {
        ...config.movable,
        events: { after: (orig, dest) => handlers.current.onMove?.(orig, dest) },
      },
      events: { change: () => api.current && handlers.current.onChange?.(api.current) },
    });
    api.current = instance;
    handlers.current.onReady?.(instance);

    let reordering = false;
    let observedShapes: Element | null = null;
    let observedCustoms: Element | null = null;
    const syncLayerOrder = (layer: Element | null) => {
      if (!layer || reordering) return;
      const autoShapes = handlers.current.autoShapes ?? [];
      if (autoShapes.length <= 1) return;
      const children = Array.from(layer.children);
      if (children.length <= 1) return;
      const autoEls: { el: Element; idx: number }[] = [];
      const otherEls: Element[] = [];
      for (const child of children) {
        const hash = child.getAttribute("cgHash") ?? "";
        const idx = matchAutoShapeIndex(hash, autoShapes);
        if (idx >= 0) autoEls.push({ el: child, idx });
        else otherEls.push(child);
      }
      if (autoEls.length <= 1) return;
      autoEls.sort((a, b) => a.idx - b.idx);
      const desired = [...autoEls.map((a) => a.el), ...otherEls];
      const alreadyOrdered = desired.every((node, i) => children[i] === node);
      if (alreadyOrdered) return;
      reordering = true;
      try {
        for (const node of desired) layer.appendChild(node);
      } finally {
        reordering = false;
      }
    };
    const syncAllLayers = () => {
      syncLayerOrder(root.querySelector("svg.cg-shapes > g"));
      syncLayerOrder(root.querySelector("svg.cg-custom-svgs > g"));
    };
    const attachLayerObservers = (obs: MutationObserver) => {
      const shapesG = root.querySelector("svg.cg-shapes > g");
      const customsG = root.querySelector("svg.cg-custom-svgs > g");
      if (shapesG && shapesG !== observedShapes) {
        observedShapes = shapesG;
        obs.observe(shapesG, { childList: true });
      }
      if (customsG && customsG !== observedCustoms) {
        observedCustoms = customsG;
        obs.observe(customsG, { childList: true });
      }
    };
    syncLayersRef.current = syncAllLayers;
    const observer = new MutationObserver(() => {
      // Chessground's redrawAll() (e.g. on board flip) replaces cg-container and recreates SVG <g> nodes.
      attachLayerObservers(observer);
      syncAllLayers();
    });
    observer.observe(root, { childList: true });
    attachLayerObservers(observer);
    syncAllLayers();

    return () => {
      syncLayersRef.current = () => {};
      observer.disconnect();
      instance.destroy();
      api.current = null;
    };
  }, []);

  // Move sounds: only when the position changed through a (new) last move, never on first render.
  const shown = useRef({ fen: props.fen, move: props.lastMove?.join("") ?? "" });
  useEffect(() => {
    const move = props.lastMove?.join("") ?? "";
    const prev = shown.current;
    shown.current = { fen: props.fen, move };
    if (!props.sound || prev.fen === props.fen || !move || move === prev.move) return;
    playSound(moveSoundFor(prev.fen, props.fen, move, props.check ?? false));
  }, [props.fen, props.lastMove, props.check, props.sound]);

  const lastAppliedFen = useRef<string | undefined>(props.fen);
  const firstConfigRun = useRef(true);
  useEffect(() => {
    if (firstConfigRun.current) {
      firstConfigRun.current = false;
      lastAppliedFen.current = config.fen;
      return;
    }
    const fenChanged = config.fen !== lastAppliedFen.current;
    lastAppliedFen.current = config.fen;
    const { movable, fen, ...restWithoutFen } = config;
    if (fenChanged && fen !== undefined) {
      api.current?.set({ ...restWithoutFen, fen, movable: { ...movable } });
      handlers.current.onShapesChange?.([]);
    } else {
      // Omit unchanged `fen` so Chessground's configure() does not wipe user-drawn shapes on sibling state updates.
      api.current?.set({ ...restWithoutFen, movable: { ...movable } });
    }
    if (config.drawable?.autoShapes) {
      api.current?.setAutoShapes(config.drawable.autoShapes);
      requestAnimationFrame(() => syncLayersRef.current());
    }
  }, [config]);

  const lastClearSignal = useRef(props.clearShapesSignal ?? 0);
  useEffect(() => {
    const sig = props.clearShapesSignal ?? 0;
    if (sig !== lastClearSignal.current) {
      lastClearSignal.current = sig;
      api.current?.setShapes([]);
      handlers.current.onShapesChange?.([]);
    }
  }, [props.clearShapesSignal]);

  const style = {
    "--board-light": theme.light,
    "--board-dark": theme.dark,
    "--board-last": theme.lastMove,
    "--board-accent": theme.accent,
    ...pieceSetCssVars(pieceSet),
  } as CSSProperties;

  const mode = props.interactionMode ?? "play";
  const brush = props.drawBrush ?? "green";
  const swipeState = useRef<{ pointerId: number; lastStepX: number } | null>(null);
  const drawState = useRef<{
    pointerId: number;
    orig: Key;
    dest: Key | undefined;
    brush: DrawBrushColor;
    baseShapes: DrawShape[];
  } | null>(null);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> would add form semantics; this is a labelled widget group.
    <div
      className={cn(
        "ks-board relative aspect-square w-full",
        `orientation-${props.orientation}`,
        props.className,
      )}
      style={style}
      data-interactive={props.free || props.dests !== undefined ? "" : undefined}
      data-interaction-mode={mode}
      role="group"
      aria-roledescription="chess board"
      aria-label={props.label ?? t("label")}
    >
      {/* chessground forces .cg-wrap to position: relative, so size it explicitly. */}
      <div ref={el} className="cg-wrap size-full" />
      {mode === "swipe" && (
        <div
          aria-hidden
          className="absolute inset-0 z-10 cursor-ew-resize touch-none"
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === "mouse") return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Synthetic pointer events in automated environments may lack an active pointerId.
            }
            swipeState.current = { pointerId: e.pointerId, lastStepX: e.clientX };
          }}
          onPointerMove={(e) => {
            const st = swipeState.current;
            if (!st || st.pointerId !== e.pointerId) return;
            const threshold = 44;
            while (Math.abs(e.clientX - st.lastStepX) >= threshold) {
              const dir = e.clientX - st.lastStepX < 0 ? "next" : "prev";
              st.lastStepX += dir === "next" ? -threshold : threshold;
              handlers.current.onSwipe?.(dir);
            }
          }}
          onPointerUp={(e) => {
            if (swipeState.current?.pointerId === e.pointerId) swipeState.current = null;
          }}
          onPointerCancel={(e) => {
            if (swipeState.current?.pointerId === e.pointerId) swipeState.current = null;
          }}
        />
      )}
      {mode === "draw" && (
        <div
          aria-hidden
          className="absolute inset-0 z-10 cursor-crosshair touch-none"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
            const orig = api.current?.getKeyAtDomPos([e.clientX, e.clientY]);
            if (!orig || !api.current) return;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Synthetic pointer events in automated environments may lack an active pointerId.
            }
            const baseShapes = [...api.current.state.drawable.shapes];
            drawState.current = { pointerId: e.pointerId, orig, dest: undefined, brush, baseShapes };
            api.current.setShapes([...baseShapes, { orig, brush }]);
          }}
          onPointerMove={(e) => {
            const st = drawState.current;
            if (!st || st.pointerId !== e.pointerId || !api.current) return;
            const over = api.current.getKeyAtDomPos([e.clientX, e.clientY]);
            const dest = over && over !== st.orig ? over : undefined;
            if (dest !== st.dest) {
              st.dest = dest;
              api.current.setShapes([
                ...st.baseShapes,
                dest ? { orig: st.orig, dest, brush: st.brush } : { orig: st.orig, brush: st.brush },
              ]);
            }
          }}
          onPointerUp={(e) => {
            const st = drawState.current;
            if (!st || st.pointerId !== e.pointerId || !api.current) return;
            drawState.current = null;
            const next = mergeDrawnShape(st.baseShapes, {
              orig: st.orig,
              ...(st.dest ? { dest: st.dest } : {}),
              brush: st.brush,
            });
            api.current.setShapes(next);
            handlers.current.onShapesChange?.(next);
          }}
          onPointerCancel={(e) => {
            const st = drawState.current;
            if (!st || st.pointerId !== e.pointerId || !api.current) return;
            drawState.current = null;
            api.current.setShapes(st.baseShapes);
          }}
        />
      )}
      {props.children}
    </div>
  );
}

/** Matches a Chessground `cgHash` string back to its index in `autoShapes` (so Line 1 always paints on top). */
export function matchAutoShapeIndex(hash: string, autoShapes: readonly DrawShape[]): number {
  const tokens = hash.split(",");
  const start = tokens[2] === "true" ? 3 : 2;
  const orig = tokens[start];
  if (!orig) return -1;
  return autoShapes.findIndex((s) => {
    if (s.orig !== orig) return false;
    if (s.dest) {
      if (tokens[start + 1] !== s.dest) return false;
      return s.brush ? tokens[start + 2] === s.brush : true;
    }
    return s.brush ? tokens[start + 1] === s.brush : true;
  });
}

/** Toggles off a matching shape with the same brush, or replaces a matching shape with a new brush. */
export function mergeDrawnShape(
  baseShapes: readonly DrawShape[],
  shape: { orig: Key; dest?: Key; brush: DrawBrushColor },
): DrawShape[] {
  const sameGeometry = (s: DrawShape) => s.orig === shape.orig && s.dest === shape.dest;
  const existing = baseShapes.find(sameGeometry);
  if (existing && existing.brush === shape.brush) {
    return baseShapes.filter((s) => !sameGeometry(s));
  }
  const rest = baseShapes.filter((s) => !sameGeometry(s));
  return [
    ...rest,
    shape.dest
      ? { orig: shape.orig, dest: shape.dest, brush: shape.brush }
      : { orig: shape.orig, brush: shape.brush },
  ];
}
