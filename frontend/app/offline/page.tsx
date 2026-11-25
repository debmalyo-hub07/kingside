// SPDX-License-Identifier: AGPL-3.0-or-later

import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.offline");
  return { title: t("title"), robots: { index: false } };
}

export default async function OfflinePage() {
  const t = await getTranslations("offline");
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <WifiOff className="mx-auto size-10 text-muted-foreground" aria-hidden />
      <h1 className="font-display text-4xl">{t("title")}</h1>
      <p className="text-muted-foreground">{t("body")}</p>
      <Link
        href="/analysis"
        className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        {t("cta")}
      </Link>
    </div>
  );
}
