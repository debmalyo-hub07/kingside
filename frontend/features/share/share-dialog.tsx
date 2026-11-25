// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { Check, Code2, Copy, Download, Film, ImageIcon, Link2, Loader2, Share2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SwitchField } from "@/components/ui/switch";
import { ApiError } from "@/lib/api";
import { useSettings } from "@/lib/settings-store";
import {
  analysisUrl,
  canShareFiles,
  canWebShare,
  copyText,
  createShareLink,
  downloadBlob,
  downloadText,
  embedCode,
  fileStem,
  type SharedAnalysis,
  shareUrl,
  webShare,
} from "./share-actions";

export interface ShareTarget {
  pgn: string;
  /** Main-line positions, start first. */
  fens: string[];
  /** Main-line UCI moves (fens.length - 1). */
  moves: string[];
  /** Index of the shown position on the main line, or null when it is off the main line. */
  ply: number | null;
  /** Shown position. */
  fen: string;
  lastMove?: string | undefined;
  orientation: "white" | "black";
  analysis?: SharedAnalysis | null;
  white?: string | undefined;
  black?: string | undefined;
  date?: string | null | undefined;
}

type Busy = null | "link" | "png" | "gif";

/** Same cap as lib/game-gif.ts (kept here so the GIF encoder loads only when used). */
const GIF_MAX_FRAMES = 400;

function CopyField({ value, label }: { value: string; label: string }) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          setCopied(await copyText(value));
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}

/** Every way to share a game or position: link, embed, PGN, FEN, PNG, GIF, OS share sheet. */
export function ShareDialog({
  target,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  target: ShareTarget;
  /** Custom trigger; `null` = no trigger (controlled dialog). */
  trigger?: React.ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("share");
  const settings = useSettings();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (v: boolean) => {
    setOwnOpen(v);
    onOpenChange?.(v);
  };
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [atMove, setAtMove] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const gifAbort = useRef<AbortController | null>(null);
  const hasMoves = target.moves.length > 0;
  const stem = fileStem([target.white, target.black, target.date?.replace(/\./g, "-")]);
  const linkPly = atMove && target.ply ? target.ply : undefined;

  // A new game/position invalidates the link shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on content change only.
  useEffect(() => {
    setId(null);
    setError(null);
  }, [target.pgn, target.orientation]);

  useEffect(() => {
    if (!open) gifAbort.current?.abort();
  }, [open]);

  const note = (text: string) => {
    setFlash(text);
    setTimeout(() => setFlash(null), 1600);
  };

  const imageOptions = {
    orientation: target.orientation,
    boardThemeId: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coordinates: settings.coordinates,
  };

  const makeLink = async () => {
    setBusy("link");
    setError(null);
    try {
      setId(
        await createShareLink({
          pgn: target.pgn,
          orientation: target.orientation,
          analysis: target.analysis ?? null,
        }),
      );
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "request_failed";
      setError(
        t(
          `errors.${code === "backend_unreachable" || code === "rate_limited" || code === "too_many_moves" ? code : "generic"}`,
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const png = async (mode: "download" | "share") => {
    setBusy("png");
    try {
      const { boardPng } = await import("@/lib/board-image");
      const blob = await boardPng({
        ...imageOptions,
        fen: target.fen,
        lastMove: target.lastMove,
        size: 1024,
      });
      const file = new File([blob], `${stem}.png`, { type: "image/png" });
      if (mode === "share" && canShareFiles(file)) await webShare({ files: [file], title: "Kingside" });
      else downloadBlob(blob, file.name);
    } catch {
      setError(t("errors.image"));
    } finally {
      setBusy(null);
    }
  };

  const gif = async () => {
    setBusy("gif");
    setGifProgress(0);
    const controller = new AbortController();
    gifAbort.current = controller;
    try {
      const { gameGif } = await import("@/lib/game-gif");
      const blob = await gameGif({
        ...imageOptions,
        size: 360,
        fens: target.fens,
        moves: target.moves,
        signal: controller.signal,
        onProgress: (done, total) => setGifProgress(Math.round((done / total) * 100)),
      });
      downloadBlob(blob, `${stem}.gif`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(t("errors.image"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <Dialog.Trigger asChild>
          {trigger ?? (
            <Button variant="ghost" size="sm">
              <Share2 /> {t("button")}
            </Button>
          )}
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card-solid p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{t("title")}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("close")}>
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-4 text-sm text-muted-foreground">
            {t("description")}
          </Dialog.Description>

          {error && (
            <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            {flash ?? ""}
          </p>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="size-4" aria-hidden /> {t("linkTitle")}
            </h3>
            {id ? (
              <>
                <CopyField value={shareUrl(id, linkPly)} label={t("linkTitle")} />
                {target.ply !== null && target.ply > 0 && (
                  <SwitchField
                    size="sm"
                    checked={atMove}
                    onCheckedChange={setAtMove}
                    className="items-center text-xs text-muted-foreground"
                    label={t("startAtMove", {
                      move: Math.ceil(target.ply / 2),
                      side: target.ply % 2 ? "…" : "",
                    })}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {canWebShare() && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void webShare({ title: t("shareTitle"), url: shareUrl(id, linkPly) })}
                    >
                      <Share2 /> {t("shareSheet")}
                    </Button>
                  )}
                </div>
                <details className="text-sm">
                  <summary className="flex cursor-pointer items-center gap-2 py-1 text-muted-foreground">
                    <Code2 className="size-4" aria-hidden /> {t("embedTitle")}
                  </summary>
                  <div className="mt-2">
                    <CopyField value={embedCode(id, linkPly)} label={t("embedTitle")} />
                  </div>
                </details>
                <p className="text-xs text-muted-foreground">{t("linkNote")}</p>
              </>
            ) : (
              <Button size="sm" onClick={makeLink} disabled={busy === "link"}>
                {busy === "link" ? <Loader2 className="animate-spin" /> : <Link2 />} {t("createLink")}
              </Button>
            )}
          </section>

          <section className="mt-5 space-y-2 border-t pt-4">
            <h3 className="text-sm font-medium">{t("positionTitle")}</h3>
            <CopyField value={target.fen} label="FEN" />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () =>
                  note((await copyText(analysisUrl(target.fen))) ? t("copied") : t("copyFailed"))
                }
              >
                <Link2 /> {t("copyAnalysisLink")}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy === "png"} onClick={() => png("download")}>
                {busy === "png" ? <Loader2 className="animate-spin" /> : <ImageIcon />} {t("downloadPng")}
              </Button>
              {canWebShare() && (
                <Button size="sm" variant="secondary" disabled={busy === "png"} onClick={() => png("share")}>
                  <Share2 /> {t("sharePng")}
                </Button>
              )}
            </div>
          </section>

          {hasMoves && (
            <section className="mt-5 space-y-2 border-t pt-4">
              <h3 className="text-sm font-medium">{t("gameTitle")}</h3>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => note((await copyText(target.pgn)) ? t("copied") : t("copyFailed"))}
                >
                  <Copy /> {t("copyPgn")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => downloadText(target.pgn, `${stem}.pgn`)}>
                  <Download /> {t("downloadPgn")}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy === "gif"} onClick={gif}>
                  {busy === "gif" ? <Loader2 className="animate-spin" /> : <Film />}{" "}
                  {busy === "gif" ? t("gifProgress", { pct: gifProgress }) : t("downloadGif")}
                </Button>
              </div>
              {target.fens.length > GIF_MAX_FRAMES && (
                <p className="text-xs text-muted-foreground">{t("gifCapped", { n: GIF_MAX_FRAMES })}</p>
              )}
            </section>
          )}
          {flash && <p className="mt-3 text-xs text-primary">{flash}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
