// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { isMobileBoardWorkspace, isWideWorkspace } from "@/lib/workspace-routes";
import { MobileDock } from "./mobile-dock";

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
  const mobileWorkspace = isMobileBoardWorkspace(pathname);

  return (
    <div
      className={cn(
        "flex flex-1 flex-col",
        mobileWorkspace && "max-md:h-dvh max-md:max-h-dvh max-md:overflow-hidden",
      )}
    >
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
          "mx-auto flex w-full flex-1 flex-col",
          wideWorkspace ? "max-w-[1600px]" : "max-w-7xl",
          mobileWorkspace
            ? "max-md:min-h-0 max-md:overflow-hidden max-md:px-2 max-md:pt-1.5 max-md:pb-1.5 md:px-4 md:pt-8 md:pb-8"
            : "px-4 pt-6 pb-24 sm:pt-8 md:pb-8",
        )}
      >
        {children}
      </main>
      {mobileWorkspace ? <div className="hidden md:block">{footer}</div> : footer}
      {!mobileWorkspace && <MobileDock />}
    </div>
  );
}
