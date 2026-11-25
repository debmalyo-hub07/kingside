// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AnalysisView } from "@/features/analysis/analysis-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.openings");
  return { title: t("title"), description: t("description") };
}

export default async function OpeningsPage({
  searchParams,
}: {
  searchParams: Promise<{ fen?: string | string[] }>;
}) {
  const { fen } = await searchParams;
  const first = Array.isArray(fen) ? fen[0] : fen;
  return (
    <PageMessages ns={["analysis", "explorer", "tablebase", "share"]}>
      <h1 className="sr-only">{(await getTranslations("meta.openings"))("title")}</h1>
      <AnalysisView initialFen={first?.slice(0, 100)} initialPanel="explorer" />
    </PageMessages>
  );
}
