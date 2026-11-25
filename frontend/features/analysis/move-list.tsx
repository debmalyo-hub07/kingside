// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { MoveNode } from "@kingside/chess-core";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useRef } from "react";
import { colorOfPly, formatSan } from "@/lib/notation";
import { useSettings } from "@/lib/settings-store";
import { cn } from "@/lib/utils";
import { useAnalysis } from "./analysis-store";

const NAG_GLYPHS: Record<number, string> = { 1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!" };

function moveNumber(node: MoveNode, force: boolean): string {
  const n = Math.ceil(node.ply / 2);
  if (node.ply % 2 === 1) return `${n}.`;
  return force ? `${n}…` : "";
}

/** Move tree: mainline flows inline, variations follow the move they replace, in parentheses. */
export function MoveList() {
  const tree = useAnalysis((s) => s.tree);
  useAnalysis((s) => s.version);
  const path = useAnalysis((s) => s.path);
  const goTo = useAnalysis((s) => s.goTo);
  const notation = useSettings((s) => s.notation);
  const t = useTranslations("analysis");
  const activeId = path[path.length - 1] ?? "root";
  const scroller = useRef<HTMLElement>(null);

  useEffect(() => {
    scroller.current
      ?.querySelector<HTMLElement>(`[data-node="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const move = (node: MoveNode, nodePath: string[], forceNumber: boolean): React.ReactNode[] => {
    const out: React.ReactNode[] = [
      <button
        key={node.id}
        type="button"
        data-node={node.id}
        onClick={() => goTo(nodePath)}
        aria-current={node.id === activeId ? "true" : undefined}
        className={cn(
          "rounded px-1 py-0.5 font-mono text-sm hover:bg-accent",
          node.id === activeId && "bg-primary text-primary-foreground hover:bg-primary",
        )}
      >
        <span className={cn(node.id !== activeId && "text-muted-foreground")}>
          {moveNumber(node, forceNumber)}
        </span>
        {formatSan(node.san ?? "", notation, colorOfPly(node.ply))}
        {node.nags.map((n) => NAG_GLYPHS[n] ?? "").join("")}
      </button>,
    ];
    if (node.comments.length) {
      out.push(
        <span key={`${node.id}-c`} className="px-1 text-xs text-muted-foreground italic">
          {node.comments.join(" ")}
        </span>,
      );
    }
    return out;
  };

  const continuation = (from: MoveNode, fromPath: string[], forceFirst: boolean): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let parent = from;
    let parentPath = fromPath;
    let force = forceFirst;
    while (parent.children[0]) {
      const [main, ...variations] = parent.children;
      const mainPath = [...parentPath, main.id];
      out.push(...move(main, mainPath, force));
      force = main.comments.length > 0;
      for (const v of variations) {
        const vPath = [...parentPath, v.id];
        out.push(
          <span key={`${v.id}-v`} className="inline-flex flex-wrap items-baseline text-muted-foreground">
            (&#8202;{move(v, vPath, true)}
            {continuation(v, vPath, v.comments.length > 0)}&#8202;)
          </span>,
        );
        force = true;
      }
      parent = main;
      parentPath = mainPath;
    }
    return out;
  };

  return (
    <section
      ref={scroller}
      className="max-h-72 overflow-y-auto lg:max-h-[min(50vh,28rem)]"
      aria-label={t("moves")}
    >
      {tree.root.children.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">{t("noMoves")}</p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-0.5 gap-y-1 p-2">
          {continuation(tree.root, [], true)}
        </div>
      )}
    </section>
  );
}
