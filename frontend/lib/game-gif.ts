// SPDX-License-Identifier: AGPL-3.0-or-later
// Animated GIF of a game, one frame per move (gifenc, MIT). Encoded in the browser; yields to the
// UI between frames so the page stays responsive and progress can be shown.
"use client";

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { type BoardImageOptions, drawBoard } from "./board-image";

export interface GifOptions extends Omit<BoardImageOptions, "fen" | "lastMove" | "arrows"> {
  /** Positions from the start (fens[0]) to the end; moves[i] leads from fens[i] to fens[i + 1]. */
  fens: string[];
  moves: string[];
  frameMs?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Hard cap so a huge game cannot exhaust memory (mirrored in share-dialog.tsx). */
export const GIF_MAX_FRAMES = 400;

export async function gameGif(o: GifOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("canvas 2d unavailable");
  const fens = o.fens.slice(0, GIF_MAX_FRAMES);
  const gif = GIFEncoder();
  const frameMs = o.frameMs ?? 800;
  for (let i = 0; i < fens.length; i++) {
    if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await drawBoard(canvas, { ...o, fen: fens[i] as string, lastMove: i > 0 ? o.moves[i - 1] : undefined });
    const { data } = g.getImageData(0, 0, o.size, o.size);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    const last = i === fens.length - 1;
    gif.writeFrame(index, o.size, o.size, { palette, delay: i === 0 ? 1200 : last ? 3000 : frameMs });
    o.onProgress?.(i + 1, fens.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
}
