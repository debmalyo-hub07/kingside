// SPDX-License-Identifier: AGPL-3.0-or-later
// Glicko-2 rating update (Mark Glickman, "Example of the Glicko-2 system", public algorithm).
// Used for the local puzzle rating (docs/ALGORITHMS.md §10). Own implementation.

export interface GlickoRating {
  rating: number;
  /** Rating deviation. */
  rd: number;
  /** Volatility. */
  vol: number;
}

export interface GlickoResult {
  rating: number;
  rd: number;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: number;
}

export const GLICKO_DEFAULT: GlickoRating = { rating: 1500, rd: 350, vol: 0.06 };

const SCALE = 173.7178;
const TAU = 0.75;
const EPSILON = 0.000001;
const MIN_RD = 45;
const MAX_RD = 350;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

/** One rating period with the given results. */
export function glicko2Update(player: GlickoRating, results: readonly GlickoResult[]): GlickoRating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  if (results.length === 0) {
    const grown = Math.sqrt(phi * phi + player.vol * player.vol) * SCALE;
    return { ...player, rd: Math.min(grown, MAX_RD) };
  }

  let vInv = 0;
  let sum = 0;
  for (const r of results) {
    const muJ = (r.rating - 1500) / SCALE;
    const gJ = g(r.rd / SCALE);
    const e = 1 / (1 + Math.exp(-gJ * (mu - muJ)));
    vInv += gJ * gJ * e * (1 - e);
    sum += gJ * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // New volatility via the Illinois algorithm.
  const a = Math.log(player.vol * player.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU)
    );
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return {
    rating: muNew * SCALE + 1500,
    rd: Math.min(Math.max(phiNew * SCALE, MIN_RD), MAX_RD),
    vol,
  };
}
