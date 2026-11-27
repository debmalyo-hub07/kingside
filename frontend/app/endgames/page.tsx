// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { AnalysisView } from "@/features/analysis/analysis-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.endgames");
  return { title: t("title"), description: t("description") };
}

/** Lucena position: a classic rook endgame to start from. */
const START = "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1";

export default async function EndgamesPage({
  searchParams,
}: {
  searchParams: Promise<{ fen?: string | string[] }>;
}) {
  const { fen } = await searchParams;
  const first = Array.isArray(fen) ? fen[0] : fen;
  return (
    <PageMessages ns={["analysis", "explorer", "tablebase", "share"]}>
      <h1 className="sr-only">{(await getTranslations("meta.endgames"))("title")}</h1>
      <MotionProvider>
        <AnalysisView
          initialFen={first?.slice(0, 100)}
          defaultFen={START}
          initialPanel="explorer"
          persistSession
          sessionKey="endgames"
        />
      </MotionProvider>
    </PageMessages>
  );
}
