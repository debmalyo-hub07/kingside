// SPDX-License-Identifier: AGPL-3.0-or-later

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { NAV_GROUPS, SETTINGS_ITEM } from "@/lib/site-nav";
import { safeHttpUrl } from "@/lib/utils";

export function SiteFooter() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const sourceUrl = safeHttpUrl(process.env.NEXT_PUBLIC_SOURCE_URL);
  return (
    <footer className="mt-24 border-t bg-background/60 pb-16 backdrop-blur md:pb-0">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        {NAV_GROUPS.map((group) => (
          <nav key={group.id} aria-label={nav(`groups.${group.id}`)}>
            <p className="mb-3 text-sm font-semibold">{nav(`groups.${group.id}`)}</p>
            <ul className="space-y-2 text-sm">
              {group.items.map((item) => (
                <li key={item.href}>
                  {item.soon ? (
                    <span className="text-muted-foreground/60">
                      {nav(`items.${item.id}.title`)}{" "}
                      <span className="text-xs text-gold">· {common("soon")}</span>
                    </span>
                  ) : (
                    <Link href={item.href} className="text-muted-foreground transition hover:text-primary">
                      {nav(`items.${item.id}.title`)}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>
              © {Math.max(2026, new Date().getFullYear())} {t("license")}
            </span>
            <span aria-hidden>·</span>
            <Link href={SETTINGS_ITEM.href} className="hover:text-primary">
              {t("settings")}
            </Link>
            <span aria-hidden>·</span>
            <Link href={`${SETTINGS_ITEM.href}#s-licenses`} className="hover:text-primary">
              {t("licenses")}
            </Link>
            {sourceUrl && (
              <>
                <span aria-hidden>·</span>
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                  {t("source")}
                </a>
              </>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{t("engineLabel")}</span>
            <a
              href="https://github.com/official-stockfish/Stockfish/tree/sf_19"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:text-primary hover:underline"
            >
              Stockfish 19 (GPL-3.0)
            </a>
            <span>/</span>
            <a
              href="https://github.com/nmrugg/stockfish.js"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:text-primary hover:underline"
            >
              stockfish.js
            </a>
            <span aria-hidden>·</span>
            <span>{t("piecesLabel")}</span>
            <span aria-hidden>·</span>
            <span>
              {t("dataFrom")}{" "}
              <a
                href="https://lichess.org"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:text-primary hover:underline"
              >
                lichess.org
              </a>
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
