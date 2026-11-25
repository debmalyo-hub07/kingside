// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { ChevronDown, Menu, Search, Settings, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog, NavigationMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS, type NavItem, SETTINGS_ITEM } from "@/lib/site-nav";
import { cn } from "@/lib/utils";

// Loaded on first use: keeps the search dialog out of every page's first JavaScript.
const CommandPalette = dynamic(
  () => import("@/components/command-palette").then((mod) => mod.CommandPalette),
  {
    ssr: false,
  },
);

function SoonBadge() {
  const t = useTranslations("common");
  return (
    <span className="rounded-full bg-gold/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-gold uppercase">
      {t("soon")}
    </span>
  );
}

function MenuItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const t = useTranslations("nav.items");
  const pathname = usePathname();
  const Icon = item.icon;
  const active = pathname === item.href;
  const body = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg border bg-secondary transition",
          !item.soon && "group-hover:border-primary/50 group-hover:text-primary",
          active && "border-primary/60 text-primary",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium">
          {t(`${item.id}.title`)} {item.soon && <SoonBadge />}
        </span>
        <span className="block text-xs text-muted-foreground">{t(`${item.id}.description`)}</span>
      </span>
    </>
  );
  const className = "group flex items-start gap-3 rounded-xl p-2.5 transition";
  if (item.soon) {
    return (
      <div className={cn(className, "cursor-default opacity-60")} aria-disabled="true">
        {body}
      </div>
    );
  }
  return (
    <Link href={item.href} onClick={onNavigate} className={cn(className, "hover:bg-accent")}>
      {body}
    </Link>
  );
}

export function SiteHeader() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteUsed, setPaletteUsed] = useState(false);
  const openPalette = (open: boolean) => {
    if (open) setPaletteUsed(true);
    setPaletteOpen(open);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteUsed(true);
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState("");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Logo />

        <NavigationMenu.Root
          className="relative hidden md:block"
          delayDuration={80}
          value={menu}
          onValueChange={setMenu}
        >
          <NavigationMenu.List className="flex items-center gap-1">
            {NAV_GROUPS.map((group) => {
              const groupActive = group.items.some((i) => i.href === pathname);
              return (
                <NavigationMenu.Item key={group.id} value={group.id} className="relative">
                  <NavigationMenu.Trigger
                    className={cn(
                      "group flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
                      groupActive && "text-foreground",
                    )}
                  >
                    {t(`groups.${group.id}`)}
                    <ChevronDown
                      aria-hidden
                      className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180"
                    />
                  </NavigationMenu.Trigger>
                  <NavigationMenu.Content className="absolute top-full left-0 z-40 mt-2 w-80 rounded-2xl border bg-popover p-2 shadow-2xl data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in data-[motion^=from-]:slide-in-from-top-1 data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out">
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.href}>
                          <MenuItem item={item} onNavigate={() => setMenu("")} />
                        </li>
                      ))}
                    </ul>
                  </NavigationMenu.Content>
                </NavigationMenu.Item>
              );
            })}
          </NavigationMenu.List>
        </NavigationMenu.Root>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => openPalette(true)}
            className="hidden items-center gap-2 rounded-lg border bg-secondary/60 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground sm:flex"
          >
            <Search className="size-4" aria-hidden />
            {t("search")}
            <kbd className="ml-4 rounded border bg-background px-1.5 font-mono text-[10px]">Ctrl K</kbd>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            aria-label={t("search")}
            onClick={() => openPalette(true)}
          >
            <Search />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("settings")} title={t("settings")} asChild>
            <Link href="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>
              <Settings />
            </Link>
          </Button>
          <ThemeToggle />

          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("openMenu")}>
                <Menu />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
              <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(22rem,88vw)] flex-col gap-4 overflow-y-auto border-l bg-popover p-4 shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
                <div className="flex items-center justify-between">
                  <Dialog.Title asChild>
                    <span>
                      <Logo />
                    </span>
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label={t("closeMenu")}>
                      <X />
                    </Button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">{t("menu")}</Dialog.Description>
                <nav aria-label={t("menu")} className="space-y-4">
                  {NAV_GROUPS.map((group) => (
                    <div key={group.id}>
                      <p className="px-2.5 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                        {t(`groups.${group.id}`)}
                      </p>
                      {group.items.map((item) => (
                        <MenuItem key={item.href} item={item} onNavigate={() => setDrawerOpen(false)} />
                      ))}
                    </div>
                  ))}
                  <MenuItem item={SETTINGS_ITEM} onNavigate={() => setDrawerOpen(false)} />
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
      {paletteUsed && <CommandPalette open={paletteOpen} onOpenChange={openPalette} />}
    </header>
  );
}
