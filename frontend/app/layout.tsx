// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type * as React from "react";
import { PwaRegister } from "@/components/pwa-register";
import { SettingsHydrator } from "@/components/settings-hydrator";
import { SiteChrome } from "@/components/site-chrome";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { clientMessages, SHARED } from "@/i18n/client-messages";
import "./globals.css";

const jakartaSans = Plus_Jakarta_Sans({ variable: "--font-jakarta-sans", subsets: ["latin"] });
// Mono (move lists & numeric telemetry) is not preloaded to keep initial landing paint lean.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  preload: false,
});
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.site");
  return {
    applicationName: "Kingside",
    title: { default: t("title"), template: "%s · Kingside" },
    description: t("description"),
    appleWebApp: { capable: true, title: "Kingside", statusBarStyle: "black-translucent" },
    icons: {
      icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#080b12" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${jakartaSans.variable} ${jetbrainsMono.variable} ${fraunces.variable} flex min-h-dvh flex-col font-sans`}
      >
        <SettingsHydrator />
        <PwaRegister />
        <NextIntlClientProvider messages={await clientMessages(SHARED)}>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            <SiteChrome header={<SiteHeader />} footer={<SiteFooter />}>
              {children}
            </SiteChrome>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
