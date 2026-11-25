// SPDX-License-Identifier: AGPL-3.0-or-later
// Anonymous per-browser id (CLAUDE.md §1): marks records this device created, e.g. shared games.
"use client";

const KEY = "kingside-device-id";
let memory: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function deviceId(): string {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
    const id = randomId();
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    memory ??= randomId();
    return memory;
  }
}
