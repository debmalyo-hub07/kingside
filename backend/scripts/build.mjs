// SPDX-License-Identifier: AGPL-3.0-or-later
// Production bundle build for Node environments (Render, Docker, standalone).

import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(__dirname, "..");
const outDir = resolve(backendDir, "dist");
const entryPoint = resolve(backendDir, "src/server.ts");
const outFile = resolve(outDir, "server.mjs");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

console.log(`Backend build ready: ${outFile}`);
