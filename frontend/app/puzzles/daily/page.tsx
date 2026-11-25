// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DailyPuzzle } from "@/features/puzzles/daily-puzzle";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.daily");
  return { title: t("title"), description: t("description") };
}

export default function DailyPuzzlePage() {
  return (
    <PageMessages ns={["puzzles"]}>
      <DailyPuzzle />
    </PageMessages>
  );
}
