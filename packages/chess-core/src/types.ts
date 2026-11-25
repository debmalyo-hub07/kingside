// SPDX-License-Identifier: AGPL-3.0-or-later

export type Color = "white" | "black";

/** Engine score, always from White's point of view. Exactly one of cp / mate is set. */
export type Score = { cp: number; mate?: never } | { mate: number; cp?: never };
