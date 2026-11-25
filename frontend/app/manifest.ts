// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("manifest");
  const nav = await getTranslations("nav.items");
  return {
    id: "/",
    name: t("name"),
    short_name: "Kingside",
    description: t("description"),
    start_url: "/analysis",
    scope: "/",
    display: "standalone",
    background_color: "#0b0f17",
    theme_color: "#0b0f17",
    categories: ["games", "education", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: nav("analysis.title"), url: "/analysis" },
      { name: nav("puzzles.title"), url: "/puzzles" },
      { name: nav("play.title"), url: "/play" },
      { name: nav("library.title"), url: "/library" },
    ],
  };
}
