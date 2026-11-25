// SPDX-License-Identifier: AGPL-3.0-or-later

import type messages from "./messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: "en";
    Messages: typeof messages;
  }
}
