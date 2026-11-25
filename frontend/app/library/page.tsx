// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LibraryView } from "@/features/library/library-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.library");
  return { title: t("title"), description: t("description") };
}

export default function LibraryPage() {
  return (
    <PageMessages ns={["library", "share"]}>
      <LibraryView />
    </PageMessages>
  );
}
