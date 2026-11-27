// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside's own SVG persona medallions: original geometric chess emblems keyed to bot.id.

"use client";

import type { BotPersona } from "@kingside/chess-core";
import { useId } from "react";
import { cn } from "@/lib/utils";

function Motif({ id }: { id: string }) {
  switch (id) {
    case "pip":
      // Friendly pawn silhouette with twin learning-spark dots
      return (
        <g>
          <circle
            cx="32"
            cy="32"
            r="24"
            fill="none"
            stroke="rgb(255 255 255 / 0.35)"
            strokeDasharray="3 4"
            strokeWidth="1.6"
          />
          <circle cx="32" cy="23" r="6.5" fill="rgb(255 255 255 / 0.92)" />
          <path d="M25 32h14l-2 9h-10z" fill="rgb(255 255 255 / 0.86)" />
          <rect x="20" y="42" width="24" height="5" rx="2.5" fill="rgb(255 255 255 / 0.95)" />
          <circle cx="19" cy="21" r="2" fill="rgb(255 255 255 / 0.65)" />
          <circle cx="45" cy="21" r="2" fill="rgb(255 255 255 / 0.65)" />
        </g>
      );
    case "rosa":
      // Petal diamond crest with graceful bishop/gem center
      return (
        <g>
          <polygon
            points="32,8 52,24 44,50 20,50 12,24"
            fill="rgb(255 255 255 / 0.14)"
            stroke="rgb(255 255 255 / 0.45)"
            strokeWidth="1.5"
          />
          <path d="M32 16c4 5 7 9 7 14a7 7 0 0 1-14 0c0-5 3-9 7-14z" fill="rgb(255 255 255 / 0.92)" />
          <circle cx="32" cy="30" r="2.3" fill="rgb(0 0 0 / 0.28)" />
          <path d="M22 41h20l-2 5H24z" fill="rgb(255 255 255 / 0.88)" />
        </g>
      );
    case "milo":
      // Knight silhouette + tactical spark
      return (
        <g>
          <circle cx="32" cy="32" r="24" fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="1.5" />
          <path
            d="M23 45h19l-1-5c-3-1-5-4-4-8 1-4 4-6 5-10-3-3-7-5-11-5l-3-3-2 4c-4 2-6 6-6 10l6 2 3-3c1 4-2 7-6 9z"
            fill="rgb(255 255 255 / 0.92)"
          />
          <path d="M44 15l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="rgb(255 255 255 / 0.78)" />
        </g>
      );
    case "tara":
      // Solid club-player rook tower inside octagonal shield
      return (
        <g>
          <polygon
            points="22,9 42,9 54,21 54,43 42,55 22,55 10,43 10,21"
            fill="rgb(0 0 0 / 0.14)"
            stroke="rgb(255 255 255 / 0.42)"
            strokeWidth="1.5"
          />
          <path d="M21 18h5v4h3v-4h6v4h3v-4h5v8l-3 3v12l3 4H21l3-4V29l-3-3z" fill="rgb(255 255 255 / 0.93)" />
        </g>
      );
    case "kenji":
      // Active diagonal compass & sharp bishop mitre
      return (
        <g>
          <path
            d="M14 48L48 14M14 14l10 10M40 40l10 10"
            stroke="rgb(255 255 255 / 0.36)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <circle cx="32" cy="17" r="3" fill="rgb(255 255 255 / 0.94)" />
          <path d="M32 21c5.5 4.5 8.5 9.5 7 16H25c-1.5-6.5 1.5-11.5 7-16z" fill="rgb(255 255 255 / 0.92)" />
          <path d="M30 27l5 5" stroke="rgb(0 0 0 / 0.35)" strokeWidth="2.2" strokeLinecap="round" />
          <rect x="21" y="40" width="22" height="5" rx="2" fill="rgb(255 255 255 / 0.9)" />
        </g>
      );
    case "amara":
      // Tournament diamond fortress + dual crown chevrons
      return (
        <g>
          <polygon
            points="32,8 56,32 32,56 8,32"
            fill="rgb(0 0 0 / 0.16)"
            stroke="rgb(255 255 255 / 0.48)"
            strokeWidth="1.6"
          />
          <path d="M19 37l4-14 9 7 9-7 4 14z" fill="rgb(255 255 255 / 0.93)" />
          <rect x="20" y="40" width="24" height="5" rx="2" fill="rgb(255 255 255 / 0.88)" />
          <circle cx="23" cy="20" r="2" fill="rgb(255 255 255 / 0.9)" />
          <circle cx="41" cy="20" r="2" fill="rgb(255 255 255 / 0.9)" />
        </g>
      );
    case "viktor":
      // Expert angular knight crest & twin rank chevrons
      return (
        <g>
          <path
            d="M12 22l20-11 20 11v18L32 53 12 40z"
            fill="rgb(0 0 0 / 0.18)"
            stroke="rgb(255 255 255 / 0.48)"
            strokeWidth="1.6"
          />
          <path
            d="M22 43h20l-2-7c-4-2-5-5-3-9l5-7-9-3-4 4-6 3 3 4 4-1-3 7-5 3z"
            fill="rgb(255 255 255 / 0.94)"
          />
          <path d="M21 47h22" stroke="rgb(255 255 255 / 0.75)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );
    case "selene":
      // Master crescent moon & endgame king crown
      return (
        <g>
          <path d="M40 13a17 17 0 1 0 11 29 14 14 0 1 1-11-29z" fill="rgb(255 255 255 / 0.35)" />
          <path d="M22 41l-3-14 8 6 5-9 5 9 8-6-3 14z" fill="rgb(255 255 255 / 0.94)" />
          <rect x="22" y="43" width="20" height="4" rx="2" fill="rgb(255 255 255 / 0.9)" />
          <circle cx="32" cy="18" r="2.2" fill="rgb(255 255 255 / 0.95)" />
        </g>
      );
    case "atlas":
      // Grandmaster meridian rings & pillared king emblem
      return (
        <g>
          <circle cx="32" cy="32" r="23" fill="none" stroke="rgb(255 255 255 / 0.38)" strokeWidth="1.6" />
          <ellipse
            cx="32"
            cy="32"
            rx="12"
            ry="23"
            fill="none"
            stroke="rgb(255 255 255 / 0.28)"
            strokeWidth="1.3"
          />
          <line x1="9" y1="32" x2="55" y2="32" stroke="rgb(255 255 255 / 0.25)" strokeWidth="1.3" />
          <path d="M22 41l-2-13 7 4 5-10 5 10 7-4-2 13z" fill="rgb(255 255 255 / 0.94)" />
          <rect x="21" y="43" width="22" height="4.5" rx="2" fill="rgb(255 255 255 / 0.9)" />
        </g>
      );
    case "max":
      // Kingside Max: emerald-gold starburst crest & sovereign crown-cross
      return (
        <g>
          <circle cx="32" cy="32" r="25" fill="none" stroke="rgb(255 255 255 / 0.52)" strokeWidth="1.8" />
          <path
            d="M32 10v8M28 14h8"
            stroke="rgb(255 255 255 / 0.96)"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path d="M18 41l-2-15 9 6 7-10 7 10 9-6-2 15z" fill="rgb(255 255 255 / 0.95)" />
          <rect x="19" y="43" width="26" height="5" rx="2.5" fill="rgb(255 255 255 / 0.92)" />
          <circle cx="16" cy="23" r="2" fill="rgb(255 255 255 / 0.92)" />
          <circle cx="48" cy="23" r="2" fill="rgb(255 255 255 / 0.92)" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M18 40l-2-14 8 6 8-10 8 10 8-6-2 14z" fill="rgb(255 255 255 / 0.9)" />
          <rect x="19" y="43" width="26" height="4" rx="2" fill="rgb(255 255 255 / 0.85)" />
        </g>
      );
  }
}

export function BotAvatar({ bot, className }: { bot: BotPersona; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `bot-${bot.id}-${uid}`;
  const sheenId = `bot-sheen-${bot.id}-${uid}`;
  const [a, b] = bot.colors;
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={bot.name}
      data-bot-avatar={bot.id}
      className={cn("size-12 shrink-0 drop-shadow-xs", className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
        <radialGradient id={sheenId} cx="30%" cy="25%" r="70%">
          <stop offset="0" stopColor="rgb(255 255 255 / 0.34)" />
          <stop offset="1" stopColor="rgb(0 0 0 / 0.24)" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30.5" fill={`url(#${gradId})`} />
      <circle cx="32" cy="32" r="30.5" fill={`url(#${sheenId})`} />
      <circle cx="32" cy="32" r="29" fill="none" stroke="rgb(255 255 255 / 0.28)" strokeWidth="1.2" />
      <Motif id={bot.id} />
    </svg>
  );
}
