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

export interface ChessBoardProps {
  fen: string;
  orientation: Color;
  turnColor?: Color;
  lastMove?: Key[];
  check?: boolean;
  /** Legal destinations; omit for a read-only board. */
  dests?: Dests;
  /** Editor mode: pieces move anywhere, dropped off the board = deleted. */
  free?: boolean;
  autoShapes?: DrawShape[];
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
            color: interactive ? (props.turnColor ?? "white") : undefined,
            dests: props.dests ?? new Map(),
            showDests: true,
          },
      selectable: { enabled: interactive },
      draggable: { enabled: interactive, deleteOnDropOff: !!props.free },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, autoShapes: props.autoShapes ?? [] },
    };
  }, [
    props.fen,
    props.orientation,
    props.turnColor,
    props.lastMove,
    props.check,
    props.dests,
    props.free,
    props.autoShapes,
    coordinates,
    animationMs,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: created once; later prop changes go through api.set below.
  useEffect(() => {
    if (!el.current) return;
    const instance = Chessground(el.current, {
      ...config,
      movable: {
        ...config.movable,
        events: { after: (orig, dest) => handlers.current.onMove?.(orig, dest) },
      },
      events: { change: () => api.current && handlers.current.onChange?.(api.current) },
    });
    api.current = instance;
    handlers.current.onReady?.(instance);
    return () => {
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

  useEffect(() => {
    const { movable, ...rest } = config;
    api.current?.set({ ...rest, movable: { ...movable } });
    if (config.drawable?.autoShapes) api.current?.setAutoShapes(config.drawable.autoShapes);
  }, [config]);

  const style = {
    "--board-light": theme.light,
    "--board-dark": theme.dark,
    "--board-last": theme.lastMove,
    "--board-accent": theme.accent,
    ...pieceSetCssVars(pieceSet),
  } as CSSProperties;

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
      role="group"
      aria-roledescription="chess board"
      aria-label={props.label ?? t("label")}
    >
      {/* chessground forces .cg-wrap to position: relative, so size it explicitly. */}
      <div ref={el} className="cg-wrap size-full" />
      {props.children}
    </div>
  );
}
