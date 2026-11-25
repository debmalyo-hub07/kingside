// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen } from "@kingside/chess-core";
import type { Api } from "chessground/api";
import type { Key, Piece } from "chessground/types";
import { INITIAL_BOARD_FEN } from "chessops/fen";
import { Check, Copy, Eraser, FlipVertical2, Hand, LineChart, RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { ChessBoard } from "@/components/board/chess-board";
import { BoardSettings } from "@/components/board-settings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { type PieceColor, pieceUrl, type Role } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";
import { usePositionErrorText } from "@/lib/use-position-error";
import { cn } from "@/lib/utils";
import { type Castling, castlingString, isEnPassantConsistent, parseInitialEditorFen } from "./editor-fen";

const ROLES: Role[] = ["king", "queen", "rook", "bishop", "knight", "pawn"];
const EMPTY_BOARD_FEN = "8/8/8/8/8/8/8/8";

type Tool = { kind: "move" } | { kind: "trash" } | { kind: "piece"; piece: Piece };

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
  const [copied, setCopied] = useState(false);
  const api = useRef<Api | null>(null);
  const pieceSet = useSettings((s) => s.pieceSet);

  const fen = `${board} ${turn} ${castlingString(board, castling)} ${enPassant} ${halfmoves} ${fullmoves}`;
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
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button === 0 && api.current) {
                api.current.dragNewPiece({ role, color }, e.nativeEvent, true);
              }
            }}
            className={cn(
              "size-11 cursor-grab touch-none rounded-md p-0.5 transition hover:bg-accent sm:size-12",
              active && "bg-primary/30 ring-2 ring-primary",
            )}
          >
            <Image
              src={pieceUrl(pieceSet, color, role)}
              alt=""
              width={48}
              height={48}
              loading="eager"
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,24rem)]">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-14rem))] space-y-2">
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

      <aside className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-sm">
        <div className="flex flex-wrap gap-1">
          <Button
            variant={tool.kind === "move" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTool({ kind: "move" })}
          >
            <Hand /> {t("move")}
          </Button>
          <Button
            variant={tool.kind === "trash" ? "secondary" : "ghost"}
            size="sm"
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

        <div className="flex gap-2">
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
            }}
          >
            {t("clear")}
          </Button>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">{t("sideToMove")}</legend>
          <Select
            value={turn}
            onValueChange={(v) => {
              const nextTurn = v as "w" | "b";
              setTurn(nextTurn);
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
                onCheckedChange={(v) => setCastling((c) => ({ ...c, [key]: v }))}
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
            onKeyDown={(e) => e.key === "Enter" && fenDraft !== null && applyFen(fenDraft)}
            onBlur={() => fenDraft !== null && applyFen(fenDraft)}
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

        <div className="flex gap-2">
          <Button asChild={!error} disabled={!!error} className="flex-1">
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
