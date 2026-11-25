// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SharedGameLoader } from "@/features/share/shared-game-loader";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.embed");
  return { title: t("title"), robots: { index: false } };
}

export default async function EmbedGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageMessages ns={["viewer", "share"]}>
      <div data-embed>
        <SharedGameLoader id={id.slice(0, 16)} embed />
      </div>
    </PageMessages>
  );
}
