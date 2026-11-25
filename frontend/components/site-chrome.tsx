// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { MobileDock } from "./mobile-dock";

function isWideWorkspace(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/analysis" ||
    pathname.startsWith("/analysis/") ||
    pathname === "/review" ||
    pathname.startsWith("/review/")
  );
}

/** Header + main + footer, except on /embed/* pages, which show only their content. */
export function SiteChrome({
  header,
  footer,
  children,
}: {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations("common");
  if (pathname?.startsWith("/embed/")) return <>{children}</>;
  const wideWorkspace = isWideWorkspace(pathname);
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t("skipToContent")}
      </a>
      {header}
      <main
        id="main"
        className={cn(
          "mx-auto w-full flex-1 px-4 pt-6 pb-24 sm:pt-8 md:pb-8",
          wideWorkspace ? "max-w-[1600px]" : "max-w-7xl",
        )}
      >
        {children}
      </main>
      {footer}
      <MobileDock />
    </>
  );
}
