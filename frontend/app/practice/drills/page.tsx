// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { DrillTrainer } from "@/features/practice/drill-trainer";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("practice.drill");
  const meta = await getTranslations("meta.practice");
  return { title: `${t("title")} · ${meta("title")}`, robots: { index: false } };
}

export default function DrillsPage() {
  return (
    <PageMessages ns={["practice"]}>
      <MotionProvider>
        <DrillTrainer />
      </MotionProvider>
    </PageMessages>
  );
}
