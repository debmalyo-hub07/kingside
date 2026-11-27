// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { ReviewView } from "@/features/review/review-view";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.review");
  return { title: t("title"), description: t("description") };
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    site?: string | string[];
    user?: string | string[];
    game?: string | string[];
  }>;
}) {
  const { site, user, game } = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <PageMessages ns={["review", "reviewOptions", "share"]}>
      <MotionProvider>
        <ReviewView initialSite={first(site)} initialUser={first(user)} initialGame={first(game)} />
      </MotionProvider>
    </PageMessages>
  );
}
