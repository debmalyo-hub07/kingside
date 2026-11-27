// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { ALL_PRACTICE, practiceById } from "@/features/practice/positions";
import { PracticeSession } from "@/features/practice/practice-session";
import { PageMessages } from "@/i18n/client-messages";

export function generateStaticParams() {
  return ALL_PRACTICE.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = practiceById((await params).id);
  if (!p) return {};
  const t = await getTranslations("practice.positions");
  const meta = await getTranslations("meta.practice");
  return { title: `${t(`${p.id}.title`)} · ${meta("title")}`, description: t(`${p.id}.text`) };
}

export default async function PracticePositionPage({ params }: { params: Promise<{ id: string }> }) {
  const position = practiceById((await params).id);
  if (!position) notFound();
  return (
    <PageMessages ns={["practice"]}>
      <MotionProvider>
        <PracticeSession key={position.id} position={position} />
      </MotionProvider>
    </PageMessages>
  );
}
