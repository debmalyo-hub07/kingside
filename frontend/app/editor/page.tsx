// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MotionProvider } from "@/components/motion-provider";
import { BoardEditor } from "@/features/editor/board-editor";
import { PageMessages } from "@/i18n/client-messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.editor");
  return { title: t("title"), description: t("description") };
}

export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ fen?: string | string[] }>;
}) {
  const { fen } = await searchParams;
  const initialFen = (Array.isArray(fen) ? fen[0] : fen)?.slice(0, 200);
  return (
    <PageMessages ns={["editor"]}>
      <h1 className="sr-only">{(await getTranslations("meta.editor"))("title")}</h1>
      <MotionProvider>
        <BoardEditor initialFen={initialFen} />
      </MotionProvider>
    </PageMessages>
  );
}
