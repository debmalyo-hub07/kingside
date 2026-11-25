// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { PuzzleTrainer } from "@/features/puzzles/puzzle-trainer";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.puzzles");
  return { title: t("title"), description: t("description") };
}

export default async function PuzzlesPage() {
  return (
    <PageMessages ns={["puzzles"]}>
      <h1 className="sr-only">{(await getTranslations("meta.puzzles"))("title")}</h1>
      <MotionProvider>
        <PuzzleTrainer />
      </MotionProvider>
    </PageMessages>
  );
}
