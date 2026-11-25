// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InsightsView } from "@/features/insights/insights-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.insights");
  return { title: t("title"), description: t("description") };
}

export default function InsightsPage() {
  return (
    <PageMessages ns={["insights"]}>
      <InsightsView />
    </PageMessages>
  );
}
