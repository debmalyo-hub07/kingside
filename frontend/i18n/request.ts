// SPDX-License-Identifier: AGPL-3.0-or-later
// next-intl request config. English only for now; add a locale by adding messages/<locale>.json
// and choosing it here (e.g. from a cookie or Accept-Language).

import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["en"] as const;
export const DEFAULT_LOCALE = "en";

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
