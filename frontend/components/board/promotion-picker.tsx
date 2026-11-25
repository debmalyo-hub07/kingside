// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { Color } from "chessground/types";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { type PieceColor, pieceUrl, type Role } from "@/lib/piece-sets";
import { useSettings } from "@/lib/settings-store";

const CHOICES: Exclude<Role, "king" | "pawn">[] = ["queen", "knight", "rook", "bishop"];

/** Overlay shown on top of the board while the user picks a promotion piece. */
export function PromotionPicker({
  color,
  onPick,
  onCancel,
}: {
  color: Color;
  onPick: (role: Exclude<Role, "king" | "pawn">) => void;
  onCancel: () => void;
}) {
  const pieceSet = useSettings((s) => s.pieceSet);
  const t = useTranslations("board.promotion");
  const queen = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    queen.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div role="dialog" aria-label={t("choose")} className="absolute inset-0 z-20 grid place-items-center">
      <button
        type="button"
        aria-label={t("cancel")}
        onClick={onCancel}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <div className="relative flex gap-2 rounded-xl bg-card p-2 shadow-xl">
        {CHOICES.map((role) => (
          <button
            key={role}
            ref={role === "queen" ? queen : undefined}
            type="button"
            aria-label={t(`to.${role}`)}
            onClick={() => onPick(role)}
            className="size-16 rounded-lg bg-secondary p-1 transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:size-20"
          >
            <Image
              src={pieceUrl(pieceSet, color as PieceColor, role)}
              alt=""
              width={72}
              height={72}
              loading="eager"
              unoptimized
              className="size-full"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
