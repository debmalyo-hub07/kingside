// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { SharedGameLoader } from "@/features/share/shared-game-loader";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.shared");
  return { title: t("title"), description: t("description") };
}

export default async function SharedGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageMessages ns={["viewer", "share"]}>
      <MotionProvider>
        <SharedGameLoader id={id.slice(0, 16)} />
      </MotionProvider>
    </PageMessages>
  );
}
