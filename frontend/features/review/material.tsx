// SPDX-License-Identifier: AGPL-3.0-or-later
// Captured pieces and material balance for one side, from the current position.

import { positionFromFen } from "@kingside/chess-core";
import { useTranslations } from "next-intl";

const ORDER = ["queen", "rook", "bishop", "knight", "pawn"] as const;
const VALUE = { queen: 9, rook: 5, bishop: 3, knight: 3, pawn: 1 } as const;
const START = { queen: 1, rook: 2, bishop: 2, knight: 2, pawn: 8 } as const;
const GLYPH = { queen: "♛", rook: "♜", bishop: "♝", knight: "♞", pawn: "♟" } as const;

type Role = (typeof ORDER)[number];

function counts(fen: string): Record<"white" | "black", Record<Role, number>> {
  const pos = positionFromFen(fen);
  const out = {
    white: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
    black: { queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
  };
  for (const [, p] of pos.board) if (p.role !== "king") out[p.color][p.role]++;
  return out;
}

/** Pieces `color` has captured (missing from the opponent's start set) and the material lead, e.g. "♞♟♟ +5". */
export function Captured({ fen, color, label }: { fen: string; color: "white" | "black"; label?: string }) {
  const t = useTranslations("board");
  const c = counts(fen);
  const opp = color === "white" ? "black" : "white";
  const taken = ORDER.flatMap((r) => Array<Role>(Math.max(0, START[r] - c[opp][r])).fill(r));
  const score = (side: "white" | "black") => ORDER.reduce((a, r) => a + VALUE[r] * c[side][r], 0);
  const lead = score(color) - score(opp);
  if (taken.length === 0 && lead <= 0) return null;
  const title = label ?? t("captured");
  return (
    <span
      role="img"
      className="flex items-center gap-1 text-xs text-muted-foreground"
      aria-label={`${title}: ${lead > 0 ? `+${lead}` : "="}`}
      title={title}
    >
      <span aria-hidden className="tracking-[-0.15em]">
        {taken.map((r) => GLYPH[r]).join("")}
      </span>
      {lead > 0 && (
        <span aria-hidden className="font-mono">
          +{lead}
        </span>
      )}
    </span>
  );
}
