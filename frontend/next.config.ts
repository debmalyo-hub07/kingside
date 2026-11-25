// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isDev = process.env.NODE_ENV === "development";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL) ?? "http://localhost:8787";
const connectSources = [
  "'self'",
  apiOrigin,
  ...(isDev
    ? ["http://localhost:8787", "http://127.0.0.1:8787", "ws://localhost:3000", "ws://127.0.0.1:3000"]
    : []),
];

function buildCsp(frameAncestors: string): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(isDev ? ["'unsafe-eval'"] : [])];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src ${[...new Set(connectSources)].join(" ")}`,
    "manifest-src 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

const commonHeaders = [
  // Cross-origin isolation enables SharedArrayBuffer for multi-threaded Stockfish (CLAUDE.md §5).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@kingside/chess-core", "@kingside/uci"],
  async headers() {
    return [
      {
        // Everything except the embeddable board may not be framed.
        source: "/((?!embed/).*)",
        headers: [
          ...commonHeaders,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: buildCsp("'none'") },
        ],
      },
      {
        // /embed/g/<id>: meant to be shown in an <iframe> on any site.
        source: "/embed/:path*",
        headers: [
          ...commonHeaders,
          { key: "Content-Security-Policy", value: buildCsp("*") },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
      {
        source: "/engine/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
