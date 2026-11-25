// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowRight, Code2, Download, EyeOff, FileSearch, Laptop, LineChart, UserX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Reveal, SectionHeading } from "./reveal";

const STEPS = [
  { icon: Download, key: "bring" },
  { icon: FileSearch, key: "rated" },
  { icon: LineChart, key: "study" },
] as const;

export function ReviewSteps() {
  const t = useTranslations("home.review");
  return (
    <section id="review" className="scroll-mt-24">
      <SectionHeading
        eyebrow={t("eyebrow")}
        title={t.rich("title", { em: (c) => <em className="text-gradient">{c}</em> })}
      />
      <div className="relative">
        <span
          aria-hidden
          className="absolute top-12 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-primary/0 via-primary/50 to-gold/0 md:block"
        />
        <ol className="relative grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, key }, i) => (
            <Reveal
              key={key}
              delay={i * 0.1}
              as="li"
              className="glass relative h-full rounded-3xl p-6 text-center"
            >
              <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                <Icon className="size-5" />
              </span>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("step", { n: i + 1 })}</p>
              <h3 className="text-lg font-semibold">{t(`steps.${key}.title`)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t(`steps.${key}.text`)}</p>
            </Reveal>
          ))}
        </ol>
      </div>
      <div className="mt-8 text-center">
        <Link
          href="/review"
          className="group inline-flex items-center gap-2 rounded-xl border bg-secondary/60 px-5 py-3 font-medium transition hover:border-primary/50"
        >
          {t("cta")}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </section>
  );
}

const VALUES = [
  { icon: UserX, key: "account" },
  { icon: EyeOff, key: "ads" },
  { icon: Laptop, key: "device" },
  { icon: Code2, key: "open" },
] as const;

export function Values() {
  const t = useTranslations("home.values");
  return (
    <section id="values" className="scroll-mt-24">
      <SectionHeading
        eyebrow={t("eyebrow")}
        title={t.rich("title", { em: (c) => <em className="text-gradient">{c}</em> })}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {VALUES.map(({ icon: Icon, key }, i) => (
          <Reveal key={key} delay={i * 0.06} className="h-full">
            <div className="glass h-full rounded-3xl p-6">
              <Icon className="mb-4 size-6 text-gold" aria-hidden />
              <h3 className="font-semibold">{t(`items.${key}.title`)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t(`items.${key}.text`)}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  const t = useTranslations("home.cta");
  return (
    <Reveal>
      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/20 via-card to-gold/15 px-6 py-14 text-center sm:px-12">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "repeating-conic-gradient(currentColor 0 25%, transparent 0 50%)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative">
          <h2 className="font-display text-4xl tracking-tight sm:text-5xl">
            {t.rich("title", { em: (c) => <em className="text-gradient">{c}</em> })}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{t("text")}</p>
          <Link
            href="/analysis"
            className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground shadow-lg shadow-primary/30 transition hover:shadow-primary/50"
          >
            {t("button")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </Reveal>
  );
}
