// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { NAV_GROUPS, type NavItemId } from "@/lib/site-nav";
import { cn } from "@/lib/utils";

const DOCK = ["analysis", "review", "puzzles", "play", "practice"] as const satisfies readonly NavItemId[];
const ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** Phone-only bottom dock with the five main tools; the full menu stays in the header. */
export function MobileDock() {
  const t = useTranslations("nav.dock");
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {DOCK.map((id) => {
          const item = ITEMS.find((i) => i.id === id);
          if (!item) return null;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 py-2 text-[11px] transition",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 h-0.5 w-8 rounded-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className="size-5" aria-hidden />
                {t(id)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
