// SPDX-License-Identifier: AGPL-3.0-or-later
// Short share links (/g/<id>). Inputs must already be validated by the caller (backend route).

import { randomBytes } from "node:crypto";
import { SharedGame } from "./models";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHARE_ID = /^[0-9A-Za-z]{8}$/;

/** 8 random base62 characters (~47 bits). */
export function newShareId(): string {
  const bytes = randomBytes(16);
  let id = "";
  for (const b of bytes) {
    // 248 = 62 * 4 → rejection sampling keeps the distribution uniform.
    if (b < 248) id += ALPHABET[b % 62];
    if (id.length === 8) return id;
  }
  return newShareId();
}

export interface SharedAnalysis {
  whiteWin: number[];
  classes: string[];
  accuracy: { white: number | null; black: number | null };
}

export interface SharedGameDto {
  id: string;
  pgn: string;
  analysis: SharedAnalysis | null;
  orientation: "white" | "black";
  createdAt: string;
}

export async function createSharedGame(input: {
  pgn: string;
  analysis: SharedAnalysis | null;
  orientation: "white" | "black";
  ownerDeviceId: string;
}): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newShareId();
    try {
      await SharedGame.create({ _id: id, ...input, analysis: input.analysis ?? undefined });
      return id;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  throw new Error("could not allocate a share id");
}

export async function getSharedGame(id: string): Promise<SharedGameDto | null> {
  if (!SHARE_ID.test(id)) return null;
  const doc = await SharedGame.findById(id).lean<{
    _id: string;
    pgn: string;
    analysis?: SharedAnalysis;
    orientation?: "white" | "black";
    createdAt: Date;
  }>();
  if (!doc) return null;
  return {
    id: doc._id,
    pgn: doc.pgn,
    analysis: doc.analysis ?? null,
    orientation: doc.orientation ?? "white",
    createdAt: doc.createdAt.toISOString(),
  };
}
