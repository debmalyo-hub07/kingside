// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PracticeIndex } from "@/features/practice/practice-index";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.practice");
  return { title: t("title"), description: t("description") };
}

export default function PracticePage() {
  return (
    <PageMessages ns={["practice"]}>
      <PracticeIndex />
    </PageMessages>
  );
}
