// SPDX-License-Identifier: AGPL-3.0-or-later
// Sends only the message namespaces a page needs to the browser (the full catalog would be parsed
// on every page load). The layout provides SHARED; each page adds its own with <PageMessages>.

import type { Messages } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type * as React from "react";

export type Namespace = keyof Messages;

/** Used by the header, boards and widgets that appear on many pages. */
export const SHARED: readonly Namespace[] = [
  "common",
  "nav",
  "palette",
  "board",
  "speech",
  "errors",
  "apiErrors",
  "classes",
  "moveInput",
  "engine",
];

export async function clientMessages(namespaces: readonly Namespace[]): Promise<Partial<Messages>> {
  const all = (await getMessages()) as Messages;
  return Object.fromEntries(namespaces.map((ns) => [ns, all[ns]])) as Partial<Messages>;
}

/** Wraps a page so its client components get SHARED plus the page's own namespaces. */
export async function PageMessages({
  ns,
  children,
}: {
  ns: readonly Namespace[];
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider messages={await clientMessages([...SHARED, ...ns])}>
      {children}
    </NextIntlClientProvider>
  );
}
