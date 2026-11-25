// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AnalysisView } from "@/features/analysis/analysis-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.analysis");
  return { title: t("title"), description: t("description") };
}

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ fen?: string | string[]; pgn?: string | string[] }>;
}) {
  const { fen, pgn } = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 100_000);
  return (
    <PageMessages ns={["analysis", "explorer", "tablebase", "share"]}>
      <h1 className="sr-only">{(await getTranslations("meta.analysis"))("title")}</h1>
      <AnalysisView initialFen={first(fen)} initialPgn={first(pgn)} />
    </PageMessages>
  );
}
