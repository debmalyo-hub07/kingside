// SPDX-License-Identifier: AGPL-3.0-or-later
// Kingside's own bot avatars: a gradient medallion with a crown band and the bot's initial.

import type { BotPersona } from "@kingside/chess-core";
import { cn } from "@/lib/utils";

export function BotAvatar({ bot, className }: { bot: BotPersona; className?: string }) {
  const id = `bot-${bot.id}`;
  const [a, b] = bot.colors;
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={bot.name} className={cn("size-12 shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`url(#${id})`} />
      <path d="M14 20l6 8 6-9 6 9 6-9 6 9 6-8-3 13H17z" fill="rgb(255 255 255 / 0.35)" />
      <text
        x="32"
        y="50"
        textAnchor="middle"
        fontSize="20"
        fontWeight="800"
        fontFamily="var(--font-sans), sans-serif"
        fill="rgb(0 0 0 / 0.65)"
      >
        {bot.name[0]}
      </text>
    </svg>
  );
}
