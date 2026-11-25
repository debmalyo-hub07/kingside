// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { positionFromFen } from "@kingside/chess-core";
import { normalizeMove } from "chessops/chess";
import { parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/** Resolves typed SAN ("Nf3", "exd5", "O-O") or UCI ("g1f3") to a legal UCI move, else null. */
export function resolveTypedMove(fen: string, text: string): string | null {
  const input = text
    .trim()
    .replace(/0/g, "O")
    .replace(/[!?]+$/, "");
  if (!input) return null;
  const pos = positionFromFen(fen);
  const san = parseSan(pos, input) ?? parseSan(pos, input.charAt(0).toUpperCase() + input.slice(1));
  if (san) return makeUci(san);
  const raw = parseUci(input.toLowerCase());
  if (raw) {
    const move = normalizeMove(pos, raw);
    if (pos.isLegal(move)) return makeUci(move);
  }
  return null;
}

/** Text box for entering moves by keyboard (accessibility; also fast for strong players). */
export function MoveInput({
  fen,
  disabled,
  onMove,
  className,
}: {
  fen: string;
  disabled?: boolean;
  onMove: (uci: string) => boolean;
  className?: string;
}) {
  const t = useTranslations("moveInput");
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={cn("flex items-center gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const uci = resolveTypedMove(fen, value);
        if (uci && onMove(uci)) {
          setValue("");
          setError(null);
        } else {
          setError(t("illegal", { move: value.trim() }));
        }
      }}
    >
      <label htmlFor={id} className="flex items-center gap-1 text-xs text-muted-foreground">
        <Keyboard className="size-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">{t("label")}</span>
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        placeholder={t("placeholder")}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className="w-32 rounded-md border bg-background px-2 py-1 font-mono text-sm"
      />
      <p id={`${id}-err`} role="status" className="text-xs text-destructive">
        {error ?? ""}
      </p>
    </form>
  );
}
