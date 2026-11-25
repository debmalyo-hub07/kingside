// SPDX-License-Identifier: AGPL-3.0-or-later

import Link from "next/link";
import { cn } from "@/lib/utils";

/** Kingside mark: a stylised king on an emerald-to-gold tile. Own artwork. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <defs>
        <linearGradient id="ks-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#f5c56b" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ks-logo)" />
      <path
        d="M16 5.5v3.2M14.4 7.1h3.2M11 12.5c0-1.6 2.2-2.6 5-2.6s5 1 5 2.6c0 2.4-2.3 3.5-2.3 6.3h-5.4c0-2.8-2.3-3.9-2.3-6.3ZM10.5 21h11l1 3.5h-13z"
        fill="none"
        stroke="#04120c"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">Kingside</span>
    </Link>
  );
}
