// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsView } from "@/features/settings/settings-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.settings");
  return { title: t("title"), description: t("description") };
}

export default function SettingsPage() {
  return (
    <PageMessages ns={["settings", "reviewOptions"]}>
      <SettingsView />
    </PageMessages>
  );
}
