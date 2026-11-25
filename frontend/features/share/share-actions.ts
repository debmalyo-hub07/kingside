// SPDX-License-Identifier: AGPL-3.0-or-later
// Share helpers: clipboard, downloads, Web Share, and the short /g/<id> link.
"use client";

import { apiPost } from "@/lib/api";
import { deviceId } from "@/lib/device-id";

export interface SharedAnalysis {
  whiteWin: number[];
  classes: string[];
  accuracy: { white: number | null; black: number | null };
}

export function siteOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text: string, filename: string, type = "application/x-chess-pgn"): void {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Safe file name from player names / date. */
export function fileStem(parts: (string | null | undefined)[]): string {
  const stem = parts
    .filter((p): p is string => !!p && !p.includes("?"))
    .join("-")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return stem || "kingside-game";
}

export function canWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export function canShareFiles(file: File): boolean {
  try {
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** Opens the phone/OS share sheet. Resolves false if unsupported or dismissed. */
export async function webShare(data: ShareData): Promise<boolean> {
  if (!canWebShare()) return false;
  try {
    await navigator.share(data);
    return true;
  } catch {
    return false;
  }
}

const links = new Map<string, Promise<string>>();

/** Uploads the game once per page and returns its short id (cached for identical input). */
export function createShareLink(input: {
  pgn: string;
  orientation: "white" | "black";
  analysis: SharedAnalysis | null;
}): Promise<string> {
  const key = JSON.stringify(input);
  let hit = links.get(key);
  if (!hit) {
    hit = apiPost<{ id: string }>("/api/share", { ...input, ownerDeviceId: deviceId() }).then((r) => r.id);
    hit.catch(() => links.delete(key));
    links.set(key, hit);
  }
  return hit;
}

export function shareUrl(id: string, ply?: number): string {
  return `${siteOrigin()}/g/${id}${ply ? `#${ply}` : ""}`;
}

export function embedCode(id: string, ply?: number): string {
  const src = `${siteOrigin()}/embed/g/${id}${ply ? `#${ply}` : ""}`;
  return `<iframe src="${src}" width="600" height="420" title="Chess game on Kingside" style="border:0;max-width:100%" loading="lazy" allowfullscreen></iframe>`;
}

export function analysisUrl(fen: string): string {
  return `${siteOrigin()}/analysis?fen=${encodeURIComponent(fen)}`;
}
