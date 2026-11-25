// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { nodesAlongPath } from "@kingside/chess-core";
import { BookOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadOpenings, openingOf } from "@/lib/openings";
import { whenIdle } from "@/lib/when-idle";
import { useAnalysis } from "./analysis-store";

type OpeningsData = Awaited<ReturnType<typeof loadOpenings>>;

/** Name + ECO of the deepest known opening along the current line. */
export function OpeningLabel() {
  const tree = useAnalysis((s) => s.tree);
  const path = useAnalysis((s) => s.path);
  const version = useAnalysis((s) => s.version);
  const [data, setData] = useState<OpeningsData | null>(null);

  useEffect(
    () =>
      whenIdle(() => {
        loadOpenings()
          .then(setData)
          .catch(() => setData(null));
      }),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` tracks in-place tree edits.
  const opening = useMemo(
    () =>
      data
        ? openingOf(
            data,
            nodesAlongPath(tree, path).map((n) => n.fen),
          )
        : null,
    [data, tree, path, version],
  );

  if (!opening) return null;
  return (
    <p className="flex items-center gap-2 border-b px-3 py-2 text-sm">
      <BookOpen className="size-4 shrink-0 text-gold" aria-hidden />
      <span className="font-mono text-xs text-muted-foreground">{opening.eco}</span>
      <span className="truncate" title={opening.name}>
        {opening.name}
      </span>
    </p>
  );
}
