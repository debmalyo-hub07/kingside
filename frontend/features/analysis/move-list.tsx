// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { type MoveClass, type MoveNode, nodeCommentText } from "@kingside/chess-core";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  MessageSquarePlus,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ContextMenu, Dialog, DropdownMenu } from "radix-ui";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MoveClassBadge } from "@/features/review/move-classes";
import { colorOfPly, formatSan } from "@/lib/notation";
import { scrollChildIntoContainer } from "@/lib/scroll-container";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { useAnalysis } from "./analysis-store";

export const MOVE_EVAL_NAGS = [1, 2, 3, 4, 5, 6, 7] as const;

export const NAG_GLYPHS: Record<number, string> = {
  1: "!",
  2: "?",
  3: "!!",
  4: "??",
  5: "!?",
  6: "?!",
  7: "□",
  10: "=",
  13: "∞",
  14: "⩲",
  15: "⩱",
  16: "±",
  17: "∓",
  18: "+−",
  19: "−+",
};

interface BranchItem {
  node: MoveNode;
  path: string[];
}

type MainRow =
  | {
      kind: "pair";
      key: string;
      moveNo: number;
      white?: BranchItem;
      black?: BranchItem;
    }
  | {
      kind: "extras";
      key: string;
      comment?: string;
      variations: BranchItem[];
    };

function moveNumberPrefix(node: MoveNode, force: boolean): string {
  const n = Math.ceil(node.ply / 2);
  if (node.ply % 2 === 1) return `${n}.`;
  return force ? `${n}…` : "";
}

function countBranchMoves(root: MoveNode): number {
  let count = 0;
  let cur: MoveNode | undefined = root;
  while (cur) {
    count++;
    cur = cur.children[0];
  }
  return count;
}

const LOUD_CLASSES = new Set<MoveClass>(["brilliant", "great", "inaccuracy", "mistake", "miss", "blunder"]);

/**
 * Interactive variation tree: 2-column mainline table (Move # | White | Black) with
 * indented, collapsible variation sub-lines, right-click ContextMenu, and inline `...` menu.
 */
export function MoveList({
  scrollContainerRef,
  scrollTrigger,
  classifications,
}: {
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  scrollTrigger?: unknown;
  classifications?: Readonly<Record<string, MoveClass>>;
}) {
  const tree = useAnalysis((s) => s.tree);
  const version = useAnalysis((s) => s.version);
  const path = useAnalysis((s) => s.path);
  const reviewClasses = useAnalysis((s) => s.reviewClasses);
  const goTo = useAnalysis((s) => s.goTo);
  const promote = useAnalysis((s) => s.promote);
  const makeMainline = useAnalysis((s) => s.makeMainline);
  const setComment = useAnalysis((s) => s.setComment);
  const toggleNag = useAnalysis((s) => s.toggleNag);
  const remove = useAnalysis((s) => s.remove);
  const notation = useSettings((s) => s.notation);
  const t = useTranslations("analysis");
  const classMap = classifications ?? reviewClasses;

  const activeId = path[path.length - 1] ?? "root";
  const scroller = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [commentTarget, setCommentTarget] = useState<{
    node: MoveNode;
    path: string[];
    draft: string;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-center active move when switching tabs on mobile.
  useEffect(() => {
    const container = scrollContainerRef?.current ?? scroller.current;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-node="${activeId}"]`);
    scrollChildIntoContainer(container, el);
  }, [activeId, scrollContainerRef, scrollTrigger]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place tree mutations.
  const { rows, branchFlags } = useMemo(() => {
    const out: MainRow[] = [];
    const flags = new Map<string, { canPromote: boolean; canMakeMainline: boolean }>();

    const indexFlags = (parent: MoveNode, ancestorNonMain: boolean) => {
      parent.children.forEach((child, idx) => {
        const isVar = idx > 0;
        const offMain = ancestorNonMain || isVar;
        flags.set(child.id, { canPromote: isVar, canMakeMainline: offMain });
        indexFlags(child, offMain);
      });
    };
    indexFlags(tree.root, false);

    let parent = tree.root;
    let parentPath: string[] = [];

    while (parent.children[0]) {
      const white = parent.children[0];
      const whiteVars = parent.children.slice(1).map((v) => ({ node: v, path: [...parentPath, v.id] }));

      if (white.ply % 2 === 0) {
        // Position starts with Black to move.
        const blackPath = [...parentPath, white.id];
        const blackComment = nodeCommentText(white.comments);
        out.push({
          kind: "pair",
          key: `p-${white.id}`,
          moveNo: Math.ceil(white.ply / 2),
          black: { node: white, path: blackPath },
        });
        if (blackComment || whiteVars.length > 0) {
          out.push({
            kind: "extras",
            key: `ex-${white.id}`,
            ...(blackComment ? { comment: blackComment } : {}),
            variations: whiteVars,
          });
        }
        parent = white;
        parentPath = blackPath;
        continue;
      }

      const whitePath = [...parentPath, white.id];
      const whiteComment = nodeCommentText(white.comments);
      const hasWhiteInterrupt = Boolean(whiteComment) || whiteVars.length > 0;
      const black = !hasWhiteInterrupt ? white.children[0] : undefined;

      if (black) {
        const blackPath = [...whitePath, black.id];
        const blackVars = white.children.slice(1).map((v) => ({ node: v, path: [...whitePath, v.id] }));
        const blackComment = nodeCommentText(black.comments);
        out.push({
          kind: "pair",
          key: `p-${white.id}-${black.id}`,
          moveNo: Math.ceil(white.ply / 2),
          white: { node: white, path: whitePath },
          black: { node: black, path: blackPath },
        });
        if (blackComment || blackVars.length > 0) {
          out.push({
            kind: "extras",
            key: `ex-${black.id}`,
            ...(blackComment ? { comment: blackComment } : {}),
            variations: blackVars,
          });
        }
        parent = black;
        parentPath = blackPath;
      } else {
        out.push({
          kind: "pair",
          key: `p-${white.id}`,
          moveNo: Math.ceil(white.ply / 2),
          white: { node: white, path: whitePath },
        });
        if (hasWhiteInterrupt) {
          out.push({
            kind: "extras",
            key: `ex-${white.id}`,
            ...(whiteComment ? { comment: whiteComment } : {}),
            variations: whiteVars,
          });
        }
        parent = white;
        parentPath = whitePath;
      }
    }

    return { rows: out, branchFlags: flags };
  }, [tree, version]);

  const rootComment = nodeCommentText(tree.root.comments);

  const openCommentEditor = (node: MoveNode, nodePath: string[]) => {
    setCommentTarget({ node, path: nodePath, draft: nodeCommentText(node.comments) });
  };

  const renderMenuItems = (
    node: MoveNode,
    nodePath: string[],
    Kind: typeof ContextMenu | typeof DropdownMenu,
  ) => {
    const f = branchFlags.get(node.id) ?? { canPromote: false, canMakeMainline: false };
    return (
      <>
        <div className="px-1.5 py-1">
          <p className="mb-1 px-1 text-[10px] font-medium text-muted-foreground">{t("menu.nagsLabel")}</p>
          <div className="grid grid-cols-7 gap-0.5">
            {MOVE_EVAL_NAGS.map((nag) => {
              const active = node.nags.includes(nag);
              return (
                <Kind.Item
                  key={nag}
                  onSelect={() => toggleNag(nodePath, nag)}
                  aria-label={t(`nags.${nag}` as never)}
                  title={t(`nags.${nag}` as never)}
                  className={cn(
                    "grid h-7 cursor-pointer place-items-center rounded font-mono text-xs font-semibold outline-none select-none data-[highlighted]:bg-accent",
                    active
                      ? "bg-primary text-primary-foreground data-[highlighted]:bg-primary"
                      : "text-foreground",
                  )}
                >
                  {NAG_GLYPHS[nag]}
                </Kind.Item>
              );
            })}
          </div>
        </div>
        <Kind.Separator className="my-1 h-px bg-border" />
        <Kind.Item
          onSelect={() => openCommentEditor(node, nodePath)}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[highlighted]:bg-accent"
        >
          <MessageSquarePlus className="size-3.5 text-muted-foreground" aria-hidden />
          {t("menu.editComment")}
        </Kind.Item>
        <Kind.Item
          disabled={!f.canPromote}
          onSelect={() => promote(nodePath)}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-accent"
        >
          <ArrowUp className="size-3.5 text-muted-foreground" aria-hidden />
          {t("menu.promote")}
        </Kind.Item>
        <Kind.Item
          disabled={!f.canMakeMainline}
          onSelect={() => makeMainline(nodePath)}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-accent"
        >
          <CornerUpLeft className="size-3.5 text-muted-foreground" aria-hidden />
          {t("menu.makeMainline")}
        </Kind.Item>
        <Kind.Separator className="my-1 h-px bg-border" />
        <Kind.Item
          onSelect={() => remove(nodePath)}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-destructive outline-none select-none data-[highlighted]:bg-destructive/10"
        >
          <Trash2 className="size-3.5" aria-hidden />
          {t("menu.deleteFromHere")}
        </Kind.Item>
      </>
    );
  };

  const moveControl = (
    node: MoveNode,
    nodePath: string[],
    opts: { showNumber: boolean; fullWidth?: boolean },
  ) => {
    const isActive = node.id === activeId;
    const sanText = formatSan(node.san ?? "", notation, colorOfPly(node.ply));
    const nagText = node.nags.map((n) => NAG_GLYPHS[n] ?? "").join("");
    const cls = classMap[node.id];
    const buttonLabel = cls
      ? opts.showNumber
        ? `${moveNumberPrefix(node, true)} ${sanText}${nagText}`
        : `${sanText}${nagText}`
      : undefined;

    return (
      <div
        className={cn(
          "group/cell flex min-w-0 items-center gap-0.5 rounded-md",
          opts.fullWidth ? "w-full" : "inline-flex",
          isActive && "bg-primary/12 ring-1 ring-inset ring-primary/30",
        )}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <button
              type="button"
              data-node={node.id}
              onClick={() => goTo(nodePath)}
              aria-current={isActive ? "true" : undefined}
              aria-label={buttonLabel}
              className={cn(
                "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left font-mono text-sm transition hover:bg-accent",
                opts.fullWidth && "flex-1",
                cls && LOUD_CLASSES.has(cls) && "font-semibold",
                isActive && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
              )}
            >
              {opts.showNumber && (
                <span className={cn("mr-0.5 text-xs", isActive ? "opacity-80" : "text-muted-foreground")}>
                  {moveNumberPrefix(node, true)}
                </span>
              )}
              {cls && <MoveClassBadge cls={cls} className="size-4" />}
              <span className="truncate">{sanText}</span>
              {nagText && (
                <span
                  className={cn(
                    "ml-0.5 shrink-0 font-bold",
                    isActive ? "text-primary-foreground" : "text-gold",
                  )}
                >
                  {nagText}
                </span>
              )}
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="z-50 min-w-52 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95">
              {renderMenuItems(node, nodePath, ContextMenu)}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t("moveActions", { move: sanText })}
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:opacity-100",
                isActive
                  ? "inline-flex text-primary"
                  : "hidden md:inline-flex md:opacity-0 md:group-hover/cell:opacity-100",
              )}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              collisionPadding={8}
              className="z-50 min-w-52 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
            >
              {renderMenuItems(node, nodePath, DropdownMenu)}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    );
  };

  const renderInlineBranch = (start: BranchItem): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let cur: MoveNode | undefined = start.node;
    let curPath = start.path;
    let forceNum = true;
    while (cur) {
      const comment = nodeCommentText(cur.comments);
      out.push(
        <span key={cur.id} className="inline-flex items-center">
          {moveControl(cur, curPath, { showNumber: forceNum || cur.ply % 2 === 1 })}
        </span>,
      );
      if (comment) {
        out.push(
          <span key={`${cur.id}-c`} className="px-1 text-xs text-muted-foreground italic">
            {comment}
          </span>,
        );
      }
      const nextMain: MoveNode | undefined = cur.children[0];
      const subVars = cur.children.slice(1);
      forceNum = Boolean(comment) || subVars.length > 0;
      for (const sv of subVars) {
        const svPath = [...curPath, sv.id];
        out.push(
          <span
            key={`${sv.id}-sub`}
            className="ml-1 inline-flex flex-wrap items-baseline gap-1 rounded border-l-2 border-border pl-1.5 text-xs text-muted-foreground"
          >
            ({renderInlineBranch({ node: sv, path: svPath })})
          </span>,
        );
      }
      if (!nextMain) break;
      cur = nextMain;
      curPath = [...curPath, nextMain.id];
    }
    return out;
  };

  return (
    <section
      ref={scroller}
      className={scrollContainerRef ? undefined : "max-h-72 overflow-y-auto lg:max-h-[min(50vh,28rem)]"}
      aria-label={t("moves")}
    >
      {rootComment && (
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground italic">{rootComment}</p>
      )}
      {tree.root.children.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">{t("noMoves")}</p>
      ) : (
        <div className="p-1.5">
          <table className="w-full table-fixed border-collapse">
            <tbody>
              {rows.map((row) => {
                if (row.kind === "pair") {
                  return (
                    <tr key={row.key} className="align-middle">
                      <td className="w-9 pr-1.5 text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {row.moveNo}.
                      </td>
                      <td className="w-1/2 py-0.5 pr-0.5">
                        {row.white ? (
                          moveControl(row.white.node, row.white.path, { showNumber: false, fullWidth: true })
                        ) : (
                          <span className="block px-2 py-1 font-mono text-xs text-muted-foreground/60">
                            …
                          </span>
                        )}
                      </td>
                      <td className="w-1/2 py-0.5 pl-0.5">
                        {row.black ? (
                          moveControl(row.black.node, row.black.path, { showNumber: false, fullWidth: true })
                        ) : (
                          <span className="block px-2 py-1 font-mono text-xs text-muted-foreground/40">
                            …
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={row.key}>
                    <td colSpan={3} className="py-1 pr-1 pl-3">
                      {row.comment && (
                        <p className="mb-1 rounded-md bg-surface-well px-2 py-1 text-xs text-muted-foreground italic">
                          {row.comment}
                        </p>
                      )}
                      {row.variations.length > 0 && (
                        <div className="space-y-1">
                          {row.variations.map((v) => {
                            const isCollapsed = Boolean(collapsed[v.node.id]);
                            const moveCount = countBranchMoves(v.node);
                            const headSan = formatSan(v.node.san ?? "", notation, colorOfPly(v.node.ply));
                            return (
                              <div
                                key={v.node.id}
                                className="rounded-md border-l-2 border-primary/40 bg-surface-well/60 py-1 pr-1.5 pl-2 text-xs"
                              >
                                <div className="flex items-start gap-1">
                                  <button
                                    type="button"
                                    aria-expanded={!isCollapsed}
                                    aria-label={isCollapsed ? t("expandVariation") : t("collapseVariation")}
                                    onClick={() =>
                                      setCollapsed((prev) => ({
                                        ...prev,
                                        [v.node.id]: !prev[v.node.id],
                                      }))
                                    }
                                    className="mt-1 grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight className="size-3.5" />
                                    ) : (
                                      <ChevronDown className="size-3.5" />
                                    )}
                                  </button>
                                  {isCollapsed ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setCollapsed((prev) => ({ ...prev, [v.node.id]: false }))
                                      }
                                      className="flex items-center gap-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                                    >
                                      <span>
                                        {moveNumberPrefix(v.node, true)}
                                        {headSan}
                                      </span>
                                      <span className="rounded bg-secondary px-1.5 py-px font-sans text-[10px]">
                                        {t("variationMoves", { n: moveCount })}
                                      </span>
                                    </button>
                                  ) : (
                                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-0.5">
                                      {renderInlineBranch(v)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1.5 px-1.5 text-[11px] text-muted-foreground">{t("moveHint")}</p>
        </div>
      )}

      <Dialog.Root
        open={commentTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCommentTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
            <div className="mb-2 flex items-center justify-between">
              <Dialog.Title className="text-base font-semibold">{t("comment.title")}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t("comment.cancel")}>
                  <X />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mb-3 text-xs text-muted-foreground">
              {commentTarget
                ? t("comment.description", {
                    move: formatSan(
                      commentTarget.node.san ?? "",
                      notation,
                      colorOfPly(commentTarget.node.ply),
                    ),
                  })
                : ""}
            </Dialog.Description>
            <textarea
              value={commentTarget?.draft ?? ""}
              onChange={(e) => setCommentTarget((prev) => (prev ? { ...prev, draft: e.target.value } : null))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && commentTarget) {
                  e.preventDefault();
                  setComment(commentTarget.path, commentTarget.draft);
                  setCommentTarget(null);
                }
              }}
              rows={3}
              placeholder={t("comment.placeholder")}
              className="w-full resize-y rounded-lg border bg-background p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!commentTarget) return;
                  setComment(commentTarget.path, "");
                  setCommentTarget(null);
                }}
              >
                {t("comment.clear")}
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCommentTarget(null)}>
                  {t("comment.cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!commentTarget) return;
                    setComment(commentTarget.path, commentTarget.draft);
                    setCommentTarget(null);
                  }}
                >
                  {t("comment.save")}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
