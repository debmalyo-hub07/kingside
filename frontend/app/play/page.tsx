// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { PlayView } from "@/features/play/play-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.play");
  return { title: t("title"), description: t("description") };
}

export default function PlayPage() {
  return (
    <PageMessages ns={["play", "share"]}>
      <MotionProvider>
        <PlayView />
      </MotionProvider>
    </PageMessages>
  );
}
