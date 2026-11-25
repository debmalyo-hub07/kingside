// SPDX-License-Identifier: AGPL-3.0-or-later
// Draws a position onto a canvas with the user's board palette and piece set — used for PNG export
// and GIF frames. Runs only in the browser; piece SVGs are same-origin so the canvas stays exportable.
"use client";

import { boardTheme } from "./board-themes";
import { pieceUrl, type Role } from "./piece-sets";

export interface BoardImageOptions {
  fen: string;
  orientation: "white" | "black";
  boardThemeId: string;
  pieceSet: string;
  /** Pixel size of the square image. */
  size: number;
  coordinates?: boolean;
  /** UCI of the last move (highlighted). */
  lastMove?: string | undefined;
  /** UCI moves drawn as arrows. */
  arrows?: { uci: string; color: string }[];
}

const ROLES: Record<string, Role> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const images = new Map<string, Promise<HTMLImageElement>>();

/** Loads a piece SVG with an explicit pixel size (some sets have no width/height, which breaks drawImage). */
function pieceImage(set: string, color: "white" | "black", role: Role): Promise<HTMLImageElement> {
  const url = pieceUrl(set, color, role);
  let hit = images.get(url);
  if (!hit) {
    hit = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`piece ${url}: HTTP ${r.status}`);
        return r.text();
      })
      .then((svg) => {
        const sized = svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
          const clean = attrs.replace(/\s(width|height)="[^"]*"/g, "");
          return `<svg${clean} width="256" height="256">`;
        });
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`piece ${url}: decode failed`));
          img.src = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
        });
      });
    hit.catch(() => images.delete(url));
    images.set(url, hit);
  }
  return hit;
}

function squareXY(square: string, orientation: "white" | "black", sq: number): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = orientation === "white" ? file : 7 - file;
  const y = orientation === "white" ? 7 - rank : rank;
  return [x * sq, y * sq];
}

function parsePlacement(fen: string): { square: string; piece: string }[] {
  const out: { square: string; piece: string }[] = [];
  (fen.split(" ")[0] ?? "").split("/").forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        out.push({ square: `${"abcdefgh"[file]}${8 - r}`, piece: ch });
        file++;
      }
    }
  });
  return out;
}

function drawArrow(
  g: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  sq: number,
  color: string,
) {
  const [x1, y1] = [from[0] + sq / 2, from[1] + sq / 2];
  const [x2, y2] = [to[0] + sq / 2, to[1] + sq / 2];
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = sq * 0.38;
  const width = sq * 0.16;
  const endX = x2 - Math.cos(angle) * head * 0.8;
  const endY = y2 - Math.sin(angle) * head * 0.8;
  g.save();
  g.globalAlpha = 0.8;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(endX, endY);
  g.stroke();
  g.beginPath();
  g.moveTo(x2, y2);
  g.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  g.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  g.closePath();
  g.fill();
  g.restore();
}

/** Draws the board into `canvas` (resized to `size`). Resolves when all pieces are drawn. */
export async function drawBoard(canvas: HTMLCanvasElement, o: BoardImageOptions): Promise<void> {
  const theme = boardTheme(o.boardThemeId as never);
  canvas.width = o.size;
  canvas.height = o.size;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas 2d unavailable");
  const sq = o.size / 8;
  const placement = parsePlacement(o.fen);
  const pieces = await Promise.all(
    placement.map((p) =>
      pieceImage(
        o.pieceSet,
        p.piece === p.piece.toUpperCase() ? "white" : "black",
        ROLES[p.piece.toLowerCase()] as Role,
      ),
    ),
  );

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      g.fillStyle = (r + f) % 2 === 0 ? theme.light : theme.dark;
      g.fillRect(f * sq, r * sq, sq, sq);
    }
  }
  if (o.lastMove) {
    g.fillStyle = theme.lastMove;
    for (const s of [o.lastMove.slice(0, 2), o.lastMove.slice(2, 4)]) {
      const [x, y] = squareXY(s, o.orientation, sq);
      g.fillRect(x, y, sq, sq);
    }
  }
  if (o.coordinates !== false) {
    g.font = `600 ${Math.round(sq * 0.18)}px system-ui, sans-serif`;
    for (let i = 0; i < 8; i++) {
      const file = "abcdefgh"[o.orientation === "white" ? i : 7 - i] as string;
      const rank = String(o.orientation === "white" ? 8 - i : i + 1);
      g.fillStyle = i % 2 === 0 ? theme.light : theme.dark;
      g.textBaseline = "bottom";
      g.textAlign = "right";
      g.fillText(file, (i + 1) * sq - sq * 0.06, o.size - sq * 0.04);
      g.fillStyle = i % 2 === 0 ? theme.dark : theme.light;
      g.textBaseline = "top";
      g.textAlign = "left";
      g.fillText(rank, sq * 0.05, i * sq + sq * 0.04);
    }
  }
  placement.forEach((p, i) => {
    const img = pieces[i];
    if (!img) return;
    const [x, y] = squareXY(p.square, o.orientation, sq);
    g.drawImage(img, x, y, sq, sq);
  });
  for (const a of o.arrows ?? []) {
    drawArrow(
      g,
      squareXY(a.uci.slice(0, 2), o.orientation, sq),
      squareXY(a.uci.slice(2, 4), o.orientation, sq),
      sq,
      a.color,
    );
  }
}

export async function boardPng(o: BoardImageOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await drawBoard(canvas, o);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
  );
}
