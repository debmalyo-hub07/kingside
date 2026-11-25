// SPDX-License-Identifier: AGPL-3.0-or-later
// Copies the full NNUE and lite Stockfish builds from the stockfish npm package into public/engine.
// Runs before dev/build. Skips files that are already up to date.

import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("stockfish/package.json"));
const { version } = require("stockfish/package.json");
const major = version.split(".")[0];
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "engine");

const files = [
  `stockfish-${major}.js`,
  `stockfish-${major}.wasm`,
  `stockfish-${major}-single.js`,
  `stockfish-${major}-single.wasm`,
  `stockfish-${major}-lite.js`,
  `stockfish-${major}-lite.wasm`,
  `stockfish-${major}-lite-single.js`,
  `stockfish-${major}-lite-single.wasm`,
];

await mkdir(outDir, { recursive: true });
for (const file of files) {
  const src = join(pkgDir, "bin", file);
  const dst = join(outDir, file);
  const [s, d] = await Promise.all([stat(src), stat(dst).catch(() => null)]);
  if (d && d.size === s.size && d.mtimeMs >= s.mtimeMs) continue;
  await copyFile(src, dst);
  console.log(`engine: copied ${file}`);
}
await copyFile(join(pkgDir, "Copying.txt"), join(outDir, "COPYING.txt"));
