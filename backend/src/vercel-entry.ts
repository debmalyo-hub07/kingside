// SPDX-License-Identifier: AGPL-3.0-or-later
// Vercel entry: Node (req, res) handler around the Hono app. Bundled by scripts/build-vercel.mjs.
// Local dev still uses src/server.ts.

import { getRequestListener } from "@hono/node-server";
import { createApp } from "./app";
import { readEnv } from "./env";

// biome-ignore lint/style/noDefaultExport: Vercel functions are loaded through their default export
export default getRequestListener(createApp(readEnv()).fetch);
