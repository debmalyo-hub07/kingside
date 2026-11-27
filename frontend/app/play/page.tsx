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

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ fen?: string | string[] }>;
}) {
  const { fen } = await searchParams;
  const first = (Array.isArray(fen) ? fen[0] : fen)?.slice(0, 100);
  return (
    <PageMessages ns={["play", "share"]}>
      <MotionProvider>
        <PlayView initialFen={first} />
      </MotionProvider>
    </PageMessages>
  );
}
