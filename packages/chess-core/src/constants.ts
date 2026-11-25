// SPDX-License-Identifier: AGPL-3.0-or-later

/** Logistic slope for cp -> win%. See docs/ALGORITHMS.md §2. */
export const WIN_PERCENT_K = 0.00368208;

/**
 * Logistic slope for the expected points behind move *labels* (Best … Blunder). Steeper than the accuracy
 * curve: it reproduced 49 of 56 labels of a reference review, the Lichess slope 45, a rating-fitted slope 40.
 * See docs/ALGORITHMS.md §2a and docs/adr/0004-label-win-model.md.
 */
export const LABEL_WIN_K = 0.004;

/** Centipawn clamp before cp -> win% conversion. See docs/ALGORITHMS.md §2. */
export const CP_CLAMP = 1000;

/** Move accuracy curve fit constants. See docs/ALGORITHMS.md §3. */
export const ACCURACY_A = 103.1668100711649;
export const ACCURACY_B = 0.04354415386753951;
export const ACCURACY_C = 3.166924740191411;

/** Bonus added to every non-perfect move accuracy for imperfect analysis. See docs/ALGORITHMS.md §3. */
export const ACCURACY_UNCERTAINTY_BONUS = 1;

/**
 * Clean-room Kingside Precision parameters: steeper expected-points loss decay aggregated via a
 * complexity-weighted generalized power mean (p < 1 penalizes costly errors more strongly).
 */
export const PRECISION_DECAY = 6.25;
export const PRECISION_POWER = -0.75;
export const PRECISION_FLOOR = 1;
