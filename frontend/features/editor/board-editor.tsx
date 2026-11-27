// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen } from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { Key, Piece } from "chessground/types";
import { INITIAL_BOARD_FEN } from "chessops/fen";
import { Check, Copy, Eraser, FlipVertical2, Hand, LineChart, RotateCcw, Swords } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { BoardSettings } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { type PieceColor, pieceUrl, type Role } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";
import { usePositionErrorText } from "@/lib/use-position-error";
import { cn } from "@/lib/utils";
import {
  type Castling,
  castlingString,
  EDITOR_PRESETS,
  isEnPassantConsistent,
  parseInitialEditorFen,
} from "./editor-fen";

const ROLES: Role[] = ["king", "queen", "rook", "bishop", "knight", "pawn"];
const EMPTY_BOARD_FEN = "8/8/8/8/8/8/8/8";
const EDITOR_SESSION_KEY = "kingside:editor-session:v1";

type Tool = { kind: "move" } | { kind: "trash" } | { kind: "piece"; piece: Piece };

interface PersistedEditorSession {
  fen: string;
  orientation: "white" | "black";
  tool: Tool;
  presetKey: string;
}

export function BoardEditor({ initialFen }: { initialFen?: string }) {
  const t = useTranslations("editor");
  const positionError = usePositionErrorText();
  const initial = useMemo(() => parseInitialEditorFen(initialFen), [initialFen]);
  const [board, setBoard] = useState(initial.board);
  const [turn, setTurn] = useState<"w" | "b">(initial.turn);
  const [castling, setCastling] = useState<Castling>(initial.castling);
  const [enPassant, setEnPassant] = useState(initial.enPassant);
  const [halfmoves, setHalfmoves] = useState(initial.halfmoves);
  const [fullmoves, setFullmoves] = useState(initial.fullmoves);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [tool, setTool] = useState<Tool>({ kind: "move" });
  const [fenDraft, setFenDraft] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const api = useRef<Api | null>(null);
  const dragBridgeCleanup = useRef<(() => void) | null>(null);
  const ingestedInitialFenRef = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const pieceSet = useSettings((s) => s.pieceSet);

  useEffect(() => () => dragBridgeCleanup.current?.(), []);

  const fen = `${board} ${turn} ${castlingString(board, castling)} ${enPassant} ${halfmoves} ${fullmoves}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initialFen) {
      ingestedInitialFenRef.current = initialFen;
      setHydrated(true);
      const timer = setTimeout(() => {
        if (window.location.search.includes("fen=")) {
          try {
            window.history.replaceState(null, "", window.location.pathname);
          } catch {
            // ignore
          }
        }
      }, 350);
      return () => clearTimeout(timer);
    }
    if (ingestedInitialFenRef.current !== null) return;
    try {
      const raw = window.sessionStorage?.getItem(EDITOR_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedEditorSession>;
        if (parsed && typeof parsed.fen === "string") {
          const p = parseInitialEditorFen(parsed.fen);
          setBoard(p.board);
          api.current?.set({ fen: p.board });
          setTurn(p.turn);
          setCastling(p.castling);
          setEnPassant(p.enPassant);
          setHalfmoves(p.halfmoves);
          setFullmoves(p.fullmoves);
          setFenDraft(null);
          if (parsed.orientation === "black" || parsed.orientation === "white") {
            setOrientation(parsed.orientation);
          }
          if (
            parsed.tool &&
            typeof parsed.tool === "object" &&
            (parsed.tool.kind === "move" ||
              parsed.tool.kind === "trash" ||
              (parsed.tool.kind === "piece" &&
                parsed.tool.piece &&
                (parsed.tool.piece.color === "white" || parsed.tool.piece.color === "black") &&
                ROLES.includes(parsed.tool.piece.role)))
          ) {
            setTool(parsed.tool);
          }
          if (typeof parsed.presetKey === "string") {
            setPresetKey(parsed.presetKey);
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setHydrated(true);
    }
  }, [initialFen]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined" || !window.sessionStorage) return;
    try {
      const payload: PersistedEditorSession = { fen, orientation, tool, presetKey };
      window.sessionStorage.setItem(EDITOR_SESSION_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [hydrated, fen, orientation, tool, presetKey]);
  const error = useMemo(() => {
    try {
      positionFromFen(fen);
      return null;
    } catch (e) {
      return positionError(e);
    }
  }, [fen, positionError]);

  const updateBoard = (next: string) => {
    setBoard(next);
    setPresetKey("");
    if (enPassant !== "-" && !isEnPassantConsistent(next, turn, enPassant)) setEnPassant("-");
  };

  const setBoardFen = (next: string) => {
    setBoard(next);
    api.current?.set({ fen: next });
  };

  const applyFen = (text: string) => {
    const parsed = parseInitialEditorFen(text);
    setBoardFen(parsed.board);
    setTurn(parsed.turn);
    setCastling(parsed.castling);
    setEnPassant(parsed.enPassant);
    setHalfmoves(parsed.halfmoves);
    setFullmoves(parsed.fullmoves);
    setFenDraft(null);
  };

  const onSquare = (key: Key) => {
    if (!api.current || tool.kind === "move") return;
    const pieces = new Map<Key, Piece | undefined>([[key, tool.kind === "piece" ? tool.piece : undefined]]);
    api.current.setPieces(pieces);
    api.current.selectSquare(null);
    updateBoard(api.current.getFen());
  };
  // chessground keeps the handler it was given; route through a ref to see the current tool.
  const onSquareRef = useRef(onSquare);
  onSquareRef.current = onSquare;

  const startPaletteDrag = (piece: Piece, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!api.current) return;
    if (e.pointerType === "mouse") {
      if (e.button === 0) api.current.dragNewPiece(piece, e.nativeEvent, true);
      return;
    }
    dragBridgeCleanup.current?.();
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || !api.current) return;
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
        started = true;
        api.current.dragNewPiece(piece, ev, true);
      }
      if (api.current.state.draggable.current?.newPiece) {
        document.dispatchEvent(
          new MouseEvent("mousemove", { clientX: ev.clientX, clientY: ev.clientY, bubbles: true }),
        );
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      dragBridgeCleanup.current = null;
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (started && api.current?.state.draggable.current?.newPiece) {
        document.dispatchEvent(
          new MouseEvent("mouseup", { clientX: ev.clientX, clientY: ev.clientY, bubbles: true }),
        );
      }
      cleanup();
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (started) api.current?.cancelMove();
      cleanup();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    dragBridgeCleanup.current = cleanup;
  };

  const palette = (color: PieceColor) => (
    <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
      {ROLES.map((role) => {
        const active = tool.kind === "piece" && tool.piece.role === role && tool.piece.color === color;
        return (
          <button
            key={role}
            type="button"
            aria-label={t(`pieces.${color}.${role}`)}
            aria-pressed={active}
            onClick={() => setTool(active ? { kind: "move" } : { kind: "piece", piece: { role, color } })}
            onPointerDown={(e) => startPaletteDrag({ role, color }, e)}
            className={cn(
              "size-10 cursor-grab touch-none rounded-md p-0.5 transition hover:bg-accent sm:size-12",
              active && "bg-primary/30 ring-2 ring-primary",
            )}
          >
            <Image
              src={pieceUrl(pieceSet, color, role)}
              alt=""
              width={48}
              height={48}
              unoptimized
              draggable={false}
              className="size-full"
            />
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden md:grid md:flex-initial md:gap-4 md:overflow-visible lg:grid-cols-[minmax(0,1fr)_minmax(300px,24rem)]">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-22rem))] shrink-0 space-y-1.5 md:max-w-[min(100%,calc(100dvh-14rem))] md:space-y-2">
        {palette(orientation === "white" ? "black" : "white")}
        <ChessBoard
          fen={board}
          orientation={orientation}
          free
          onChange={(a) => updateBoard(a.getFen())}
          onReady={(a) => {
            api.current = a;
            a.set({ events: { select: (key) => onSquareRef.current(key) } });
          }}
        />
        {palette(orientation)}
      </div>

      <aside className="panel-solid min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto rounded-xl p-3 text-sm md:flex-initial md:space-y-4 md:p-4">
        <div className="flex flex-wrap gap-1">
          <Button
            variant={tool.kind === "move" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tool.kind === "move"}
            onClick={() => setTool({ kind: "move" })}
          >
            <Hand /> {t("move")}
          </Button>
          <Button
            variant={tool.kind === "trash" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tool.kind === "trash"}
            onClick={() => setTool({ kind: "trash" })}
          >
            <Eraser /> {t("erase")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
          >
            <FlipVertical2 /> {t("flip")}
          </Button>
          <BoardSettings />
        </div>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBoardFen(INITIAL_BOARD_FEN);
              setCastling({ K: true, Q: true, k: true, q: true });
              setTurn("w");
              setEnPassant("-");
              setHalfmoves("0");
              setFullmoves("1");
              setFenDraft(null);
              setPresetKey("start");
            }}
          >
            <RotateCcw /> {t("start")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBoardFen(EMPTY_BOARD_FEN);
              setEnPassant("-");
              setHalfmoves("0");
              setFullmoves("1");
              setFenDraft(null);
              setPresetKey("");
            }}
          >
            {t("clear")}
          </Button>
          <Select
            value={presetKey}
            onValueChange={(id) => {
              const preset = EDITOR_PRESETS.find((p) => p.id === id);
              if (!preset) return;
              applyFen(preset.fen);
              setPresetKey(preset.id);
            }}
          >
            <SelectTrigger
              aria-label={t("presetLabel")}
              className="h-8 w-full text-xs sm:w-auto sm:min-w-[10.5rem] sm:flex-1"
            >
              <SelectValue placeholder={t("presetPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {EDITOR_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {t(`presets.${p.id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">{t("sideToMove")}</legend>
          <Select
            value={turn}
            onValueChange={(v) => {
              const nextTurn = v as "w" | "b";
              setTurn(nextTurn);
              setPresetKey("");
              if (enPassant !== "-" && !isEnPassantConsistent(board, nextTurn, enPassant)) {
                setEnPassant("-");
              }
            }}
          >
            <SelectTrigger aria-label={t("sideToMove")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="w">{t("whiteToMove")}</SelectItem>
              <SelectItem value="b">{t("blackToMove")}</SelectItem>
            </SelectContent>
          </Select>
        </fieldset>

        <fieldset>
          <legend className="mb-1 font-medium">{t("castling")}</legend>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ["K", t("castle.K")],
                ["Q", t("castle.Q")],
                ["k", t("castle.k")],
                ["q", t("castle.q")],
              ] as const
            ).map(([key, label]) => (
              <SwitchField
                key={key}
                size="sm"
                className="items-center"
                checked={castling[key]}
                onCheckedChange={(v) => {
                  setPresetKey("");
                  setCastling((c) => ({ ...c, [key]: v }));
                }}
                label={label}
              />
            ))}
          </div>
        </fieldset>

        <label className="block space-y-1">
          <span className="font-medium">FEN</span>
          <input
            value={fenDraft ?? fen}
            onChange={(e) => setFenDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && fenDraft !== null) {
                setPresetKey("");
                applyFen(fenDraft);
              }
            }}
            onBlur={() => {
              if (fenDraft !== null) {
                setPresetKey("");
                applyFen(fenDraft);
              }
            }}
            spellCheck={false}
            className="w-full min-w-0 rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("legal")}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild={!error} disabled={!!error} className="min-w-28 flex-1">
            {error ? (
              <span>
                <LineChart /> {t("analyze")}
              </span>
            ) : (
              <Link href={`/analysis?fen=${encodeURIComponent(fen)}`}>
                <LineChart /> {t("analyze")}
              </Link>
            )}
          </Button>
          <Button variant="secondary" asChild={!error} disabled={!!error}>
            {error ? (
              <span>
                <Swords /> {t("playBot")}
              </span>
            ) : (
              <Link href={`/play?fen=${encodeURIComponent(fen)}`}>
                <Swords /> {t("playBot")}
              </Link>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fen);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check /> : <Copy />} FEN
          </Button>
        </div>
      </aside>
    </div>
  );
}
