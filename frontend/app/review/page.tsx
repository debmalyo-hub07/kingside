// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReviewView } from "@/features/review/review-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.review");
  return { title: t("title"), description: t("description") };
}

export default function ReviewPage() {
  return (
    <PageMessages ns={["review", "reviewOptions", "share"]}>
      <ReviewView />
    </PageMessages>
  );
}
