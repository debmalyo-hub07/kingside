// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { FileInput, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePositionErrorText } from "@/lib/use-position-error";
import { useAnalysis } from "./analysis-store";

const MAX_INPUT = 1_000_000;

function looksLikeFen(text: string): boolean {
  const t = text.trim();
  return !t.includes("[") && t.split("/").length === 8 && t.split(/\s+/).length <= 6;
}

/** Paste a PGN or FEN to replace the current game. */
export function LoadDialog() {
  const t = useTranslations("analysis.load");
  const positionError = usePositionErrorText();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadFen = useAnalysis((s) => s.loadFen);
  const loadPgn = useAnalysis((s) => s.loadPgn);

  const submit = () => {
    const input = text.trim();
    if (!input) return;
    if (input.length > MAX_INPUT) {
      setError(t("tooLarge"));
      return;
    }
    try {
      if (looksLikeFen(input)) loadFen(input);
      else loadPgn(input);
      setOpen(false);
      setText("");
      setError(null);
    } catch (e) {
      setError(positionError(e));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("button")}>
          <FileInput />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{t("title")}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("close")}>
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-3 text-sm text-muted-foreground">
            {t("description")}
          </Dialog.Description>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={`[Event "..."]\n1. e4 e5 2. Nf3 ...\n\n${t("or")}\n\nrnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1`}
            className="w-full resize-y rounded-md border bg-background p-2 font-mono text-sm"
          />
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <Button onClick={submit}>{t("submit")}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
