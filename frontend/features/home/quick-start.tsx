// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ArrowRight, ClipboardPaste, FileSearch, LineChart, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

type Kind = "empty" | "fen" | "pgn" | "user" | "unknown";

const FEN_RE = /^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+\s+[wb]\b/;
const USER_RE = /^[A-Za-z0-9_-]{2,30}$/;

/** What the pasted text looks like. */
export function detectInput(raw: string): Kind {
  const text = raw.trim();
  if (!text) return "empty";
  if (FEN_RE.test(text)) return "fen";
  if (/^\[\w+\s+"/m.test(text) || /\b1\.\s*[a-hNBRQKO]/.test(text)) return "pgn";
  if (USER_RE.test(text)) return "user";
  return "unknown";
}

/**
 * One box for everything: a PGN, a FEN or a Lichess / Chess.com username. The detected type is
 * shown live and the actions change with it.
 */
export function QuickStart() {
  const t = useTranslations("home.quick");
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const kind = detectInput(text);

  const paste = async () => {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      // Clipboard blocked: the user can paste with the keyboard.
    }
  };

  const analyze = async () => {
    if (kind === "fen") {
      router.push(`/analysis?fen=${encodeURIComponent(text.trim())}`);
      return;
    }
    const { useAnalysis } = await import("@/features/analysis/analysis-store");
    try {
      useAnalysis.getState().loadPgn(text);
      router.push("/analysis");
    } catch {
      setFailed(true);
    }
  };
  const review = async () => {
    const { useReview } = await import("@/features/review/review-store");
    try {
      useReview.getState().start(text);
      router.push("/review");
    } catch {
      setFailed(true);
    }
  };
  const lookUp = (site: "lichess" | "chesscom") =>
    router.push(`/review?site=${site}&user=${encodeURIComponent(text.trim())}`);

  const primary =
    "inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:shadow-primary/40";
  const secondary =
    "inline-flex min-h-10 items-center gap-2 rounded-xl border bg-secondary/60 px-4 font-medium transition hover:border-primary/50";

  return (
    <form
      className="glass rounded-2xl p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (kind === "fen" || kind === "pgn") void analyze();
        else if (kind === "user") lookUp("lichess");
      }}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <label htmlFor={id} className="text-sm font-medium">
          {t("label")}
        </label>
        <span
          aria-live="polite"
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium transition",
            kind === "empty" || kind === "unknown"
              ? "bg-secondary text-muted-foreground"
              : "bg-primary/15 text-primary",
          )}
        >
          {t(`kind.${kind}`)}
        </span>
      </div>
      <div className="relative">
        <textarea
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFailed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && kind !== "pgn") {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={kind === "pgn" ? 4 : 2}
          spellCheck={false}
          placeholder={t("placeholder")}
          className="w-full resize-none rounded-xl border bg-background/60 px-3 py-2.5 pr-11 font-mono text-sm outline-none transition focus:border-primary"
        />
        <button
          type="button"
          onClick={paste}
          title={t("paste")}
          aria-label={t("paste")}
          className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ClipboardPaste className="size-4" />
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 px-1 text-sm text-destructive">
          {t("invalid")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {kind === "user" ? (
          <>
            <button type="button" className={primary} onClick={() => lookUp("lichess")}>
              <UserRound className="size-4" /> {t("lichess")}
            </button>
            <button type="button" className={secondary} onClick={() => lookUp("chesscom")}>
              <UserRound className="size-4" /> {t("chesscom")}
            </button>
          </>
        ) : kind === "pgn" ? (
          <>
            <button type="button" className={primary} onClick={() => void review()}>
              <FileSearch className="size-4" /> {t("review")}
            </button>
            <button type="button" className={secondary} onClick={() => void analyze()}>
              <LineChart className="size-4" /> {t("analyze")}
            </button>
          </>
        ) : kind === "fen" ? (
          <button type="button" className={primary} onClick={() => void analyze()}>
            <LineChart className="size-4" /> {t("analyzePosition")}
          </button>
        ) : (
          <button type="button" className={primary} onClick={() => router.push("/analysis")}>
            {t("openBoard")} <ArrowRight className="size-4" />
          </button>
        )}
      </div>
    </form>
  );
}
