// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the backend for Vercel (Build Output API v3): one bundled Node function serving every path.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const out = ".vercel/output";
const fn = `${out}/functions/index.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ["src/vercel-entry.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // CommonJS dependencies (mongoose, …) need require() inside an ES module.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", maxDuration: 30 }),
);
writeFileSync(
  `${out}/config.json`,
  JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }),
);
console.log("Vercel build output ready");
