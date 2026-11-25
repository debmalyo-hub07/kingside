// SPDX-License-Identifier: AGPL-3.0-or-later
// Renders the PWA PNG icons from public/icons/icon.svg (our own logo) with headless Chromium.
// Run once after changing the logo: node frontend/scripts/make-icons.mjs
// Uses Playwright's Chromium (set PLAYWRIGHT_CHROMIUM=/path/to/chrome to use another binary).

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = await readFile(join(dir, "icon.svg"), "utf8");
const markOnly = svg.replace(/<rect[^>]*\/>/, "");

// name, size, maskable (full-bleed background with the mark inside the 80% safe zone)
const icons = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage();
for (const [name, size, maskable] of icons) {
  await page.setViewportSize({ width: size, height: size });
  const body = maskable
    ? `<div style="width:${size}px;height:${size}px;background:linear-gradient(135deg,#34d399,#f5c56b);display:grid;place-items:center">
         <div style="width:${size * 0.78}px;height:${size * 0.78}px">${markOnly.replace("<svg", '<svg width="100%" height="100%"')}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg.replace("<svg", '<svg width="100%" height="100%"')}</div>`;
  await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
  await page.screenshot({
    path: join(dir, name),
    omitBackground: !maskable,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log(`icons: ${name}`);
}
await browser.close();
