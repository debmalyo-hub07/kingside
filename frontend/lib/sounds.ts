// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside's own sounds, synthesized with the Web Audio API — no audio files, nothing copied
// (docs/LICENSING.md). One lazily created AudioContext; every call is a no-op where audio is unavailable.
"use client";

import { useSettings } from "./settings-store";

export type SoundName =
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "promote"
  | "gameStart"
  | "gameEnd"
  | "correct"
  | "wrong"
  | "lowTime";

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const len = Math.floor(ac.sampleRate * 0.25);
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  // Deterministic pseudo-random noise (no Math.random needed).
  let seed = 12345;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff - 1) * (1 - i / len);
  }
  return noiseBuffer;
}

/** Filtered noise burst — the "wood" part of a piece being put down. */
function tap(ac: AudioContext, out: AudioNode, at: number, freq: number, decay: number, gain: number) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(band).connect(g).connect(out);
  src.start(at);
  src.stop(at + decay + 0.02);
}

/** Short pitched tone with a soft attack. */
function tone(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  dur: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function thump(ac: AudioContext, out: AudioNode, at: number, freq: number, gain: number) {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq * 1.6, at);
  osc.frequency.exponentialRampToValueAtTime(freq, at + 0.04);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + 0.09);
}

const RECIPES: Record<SoundName, (ac: AudioContext, out: AudioNode, t: number) => void> = {
  move: (ac, out, t) => {
    tap(ac, out, t, 1900, 0.06, 0.55);
    thump(ac, out, t, 170, 0.5);
  },
  capture: (ac, out, t) => {
    tap(ac, out, t, 2600, 0.05, 0.6);
    tap(ac, out, t + 0.035, 1500, 0.09, 0.7);
    thump(ac, out, t + 0.03, 120, 0.7);
  },
  check: (ac, out, t) => {
    tap(ac, out, t, 1900, 0.05, 0.45);
    tone(ac, out, t + 0.02, 880, 0.16, 0.18, "triangle");
    tone(ac, out, t + 0.1, 1318, 0.22, 0.14, "triangle");
  },
  castle: (ac, out, t) => {
    tap(ac, out, t, 1800, 0.05, 0.5);
    thump(ac, out, t, 160, 0.4);
    tap(ac, out, t + 0.09, 2100, 0.05, 0.5);
    thump(ac, out, t + 0.09, 180, 0.4);
  },
  promote: (ac, out, t) => {
    tap(ac, out, t, 1900, 0.05, 0.45);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(ac, out, t + 0.03 + i * 0.06, f, 0.18, 0.12);
    });
  },
  gameStart: (ac, out, t) => {
    tone(ac, out, t, 392, 0.25, 0.16);
    tone(ac, out, t + 0.12, 587.33, 0.35, 0.14);
  },
  gameEnd: (ac, out, t) => {
    tone(ac, out, t, 587.33, 0.3, 0.15);
    tone(ac, out, t + 0.15, 440, 0.3, 0.15);
    tone(ac, out, t + 0.3, 293.66, 0.6, 0.16);
  },
  correct: (ac, out, t) => {
    tone(ac, out, t, 659.25, 0.15, 0.14);
    tone(ac, out, t + 0.09, 987.77, 0.25, 0.14);
  },
  wrong: (ac, out, t) => {
    tone(ac, out, t, 233.08, 0.18, 0.16, "triangle");
    tone(ac, out, t + 0.12, 174.61, 0.3, 0.16, "triangle");
  },
  lowTime: (ac, out, t) => {
    tone(ac, out, t, 1200, 0.06, 0.12, "square");
  },
};

/** Plays a sound if sounds are on (settings). Safe to call anywhere on the client. */
export function playSound(name: SoundName): void {
  const { soundEnabled, soundVolume } = useSettings.getState();
  if (!soundEnabled || soundVolume <= 0) return;
  const ac = context();
  if (!ac) return;
  try {
    const master = ac.createGain();
    master.gain.value = Math.min(1, Math.max(0, soundVolume));
    master.connect(ac.destination);
    RECIPES[name](ac, master, ac.currentTime + 0.005);
  } catch {
    // Audio is a nicety; never let it break the board.
  }
}

// ---------- move sound selection from two FENs ----------

type Board = Map<string, string>;

const isWhite = (piece: string) => piece === piece.toUpperCase();

function parseBoard(fen: string): Board {
  const board: Board = new Map();
  const rows = (fen.split(" ")[0] ?? "").split("/");
  rows.forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        board.set(`${"abcdefgh"[file]}${8 - r}`, ch);
        file++;
      }
    }
  });
  return board;
}

/** Picks the sound for the move `uci` that turned `before` into `after`. */
export function moveSoundFor(before: string, after: string, uci: string, check: boolean): SoundName {
  if (check) return "check";
  const prev = parseBoard(before);
  const next = parseBoard(after);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const mover = prev.get(from);
  if (mover?.toLowerCase() === "k") {
    const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
    const target = prev.get(to);
    const ontoOwnRook = target?.toLowerCase() === "r" && isWhite(target) === isWhite(mover);
    if (fileDiff >= 2 || ontoOwnRook) return "castle";
  }
  if (mover?.toLowerCase() === "p" && next.get(to)?.toLowerCase() !== "p") return "promote";
  if (next.size < prev.size) return "capture";
  return "move";
}
