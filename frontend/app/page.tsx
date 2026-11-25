// SPDX-License-Identifier: AGPL-3.0-or-later

import { Features } from "@/features/home/features";
import { Hero } from "@/features/home/hero";
import { LegendaryGames } from "@/features/home/legendary-games";
import { FinalCta, ReviewSteps, Values } from "@/features/home/sections";
import { Stats } from "@/features/home/stats";
import { ThemeShowcase } from "@/features/home/theme-showcase";
import { PageMessages } from "@/i18n/client-messages";

export default function HomePage() {
  return (
    <PageMessages ns={["home"]}>
      <div className="space-y-24 sm:space-y-32">
        <Hero />
        <Stats />
        <LegendaryGames />
        <Features />
        <ReviewSteps />
        <ThemeShowcase />
        <Values />
        <FinalCta />
      </div>
    </PageMessages>
  );
}
