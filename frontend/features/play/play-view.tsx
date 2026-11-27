// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useEffect } from "react";
import { PlayGame } from "./play-game";
import { PlaySetup } from "./play-setup";
import { usePlay } from "./play-store";

export function PlayView({ initialFen }: { initialFen?: string | undefined }) {
  const stage = usePlay((s) => s.stage);
  const setInitialFen = usePlay((s) => s.setInitialFen);

  useEffect(() => {
    if (initialFen) {
      setInitialFen(initialFen);
      return;
    }
    const cur = usePlay.getState();
    if (!cur.hasSession) {
      cur.restoreSession();
    } else if (cur.stage === "setup") {
      setInitialFen(null);
    }
  }, [initialFen, setInitialFen]);

  return stage === "setup" ? <PlaySetup /> : <PlayGame />;
}
