// SPDX-License-Identifier: AGPL-3.0-or-later
// Turns SAN into words for screen readers: "Nxe5+" → "Knight takes e5, check".
// Words come from the message catalog (speech.*); ENGLISH is the fallback used by tests.

export interface SpeechWords {
  pieces: Record<"K" | "Q" | "R" | "B" | "N", string>;
  /** Lower-case piece names for promotions. */
  promoted: Record<"Q" | "R" | "B" | "N", string>;
  pawn: string;
  /** "{file} pawn", e.g. "e pawn". */
  filePawn: (file: string) => string;
  takes: (square: string) => string;
  to: (square: string) => string;
  promotesTo: (piece: string) => string;
  castleKingside: string;
  castleQueenside: string;
  check: string;
  checkmate: string;
  /** "{n}. White: {move}" */
  move: (n: number, white: boolean, text: string) => string;
}

export const ENGLISH: SpeechWords = {
  pieces: { K: "King", Q: "Queen", R: "Rook", B: "Bishop", N: "Knight" },
  promoted: { Q: "queen", R: "rook", B: "bishop", N: "knight" },
  pawn: "Pawn",
  filePawn: (file) => `${file} pawn`,
  takes: (sq) => `takes ${sq}`,
  to: (sq) => `to ${sq}`,
  promotesTo: (piece) => `promotes to ${piece}`,
  castleKingside: "Castles kingside",
  castleQueenside: "Castles queenside",
  check: "check",
  checkmate: "checkmate",
  move: (n, white, text) => `${n}. ${white ? "White" : "Black"}: ${text}`,
};

export function speakSan(san: string, w: SpeechWords = ENGLISH): string {
  let s = san.replace(/[!?]+$/, "");
  let suffix = "";
  if (s.endsWith("#")) {
    suffix = `, ${w.checkmate}`;
    s = s.slice(0, -1);
  } else if (s.endsWith("+")) {
    suffix = `, ${w.check}`;
    s = s.slice(0, -1);
  }
  if (s === "O-O") return `${w.castleKingside}${suffix}`;
  if (s === "O-O-O") return `${w.castleQueenside}${suffix}`;
  const promo = /=([QRBN])$/.exec(s);
  if (promo) s = s.slice(0, -2);
  const letter = s[0] ?? "";
  const piece = letter in w.pieces ? w.pieces[letter as keyof SpeechWords["pieces"]] : undefined;
  const body = piece ? s.slice(1) : s;
  const capture = body.includes("x");
  const [from = "", to = ""] = capture ? body.split("x") : [body.slice(0, -2), body.slice(-2)];
  const words = [piece ?? (from ? w.filePawn(from) : w.pawn)];
  if (piece && from) words.push(from);
  words.push(capture ? w.takes(to) : w.to(to));
  if (promo) words.push(w.promotesTo(w.promoted[promo[1] as keyof SpeechWords["promoted"]]));
  return `${words.join(" ").replace(/\s+/g, " ")}${suffix}`;
}

/** "12. White: Knight to f3" */
export function speakMove(san: string, ply: number, w: SpeechWords = ENGLISH): string {
  return w.move(Math.ceil(ply / 2), ply % 2 === 1, speakSan(san, w));
}
