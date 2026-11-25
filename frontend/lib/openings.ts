// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening names + book positions from public/data/openings.json (built by scripts/build-openings.mjs,
// data: lichess-org/chess-openings, CC0). Loaded lazily, once per page.

export interface Opening {
  eco: string;
  name: string;
}

interface OpeningsData {
  named: Record<string, [string, string]>;
  book: Set<string>;
}

let loading: Promise<OpeningsData> | null = null;

export function loadOpenings(): Promise<OpeningsData> {
  loading ??= fetch("/data/openings.json")
    .then((r) => {
      if (!r.ok) throw new Error(`openings: HTTP ${r.status}`);
      return r.json() as Promise<{ named: Record<string, [string, string]>; book: string[] }>;
    })
    .then((d) => ({ named: d.named, book: new Set(d.book) }))
    .catch((e: unknown) => {
      loading = null;
      throw e;
    });
  return loading;
}

const epd = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** Deepest named opening along a sequence of positions (start first). */
export function openingOf(data: OpeningsData, fens: readonly string[]): Opening | null {
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = data.named[epd(fens[i] as string)];
    if (hit) return { eco: hit[0], name: hit[1] };
  }
  return null;
}

/** Number of leading moves whose resulting position is a known book position. */
export function countBookPlies(data: OpeningsData, fensAfterMoves: readonly string[]): number {
  let n = 0;
  for (const fen of fensAfterMoves) {
    if (!data.book.has(epd(fen))) break;
    n++;
  }
  return n;
}
