// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { PlayGame } from "./play-game";
import { PlaySetup } from "./play-setup";
import { usePlay } from "./play-store";

export function PlayView() {
  const stage = usePlay((s) => s.stage);
  return stage === "setup" ? <PlaySetup /> : <PlayGame />;
}
