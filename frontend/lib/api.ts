// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for the Kingside backend (NEXT_PUBLIC_API_URL).

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, signal ? { signal } : {});
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("backend_unreachable", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? "request_failed", res.status);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("backend_unreachable", 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? "request_failed", res.status);
  }
  return (await res.json()) as T;
}

export interface ImportedGame {
  id: string;
  source: "lichess" | "chesscom";
  url: string;
  white: { name: string; rating: number | null };
  black: { name: string; rating: number | null };
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  timeClass: string;
  playedAt: number;
  opening: string | null;
  pgn: string;
}
