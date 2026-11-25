// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { CornerDownLeft, Moon, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Dialog } from "radix-ui";
import { useMemo, useState } from "react";
import { ALL_NAV_ITEMS } from "@/lib/site-nav";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  run: () => void;
}

/** Quick jump to any page or action (opened with Ctrl/⌘+K by the header, which loads this lazily). */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("nav.items");
  const tp = useTranslations("palette");
  const common = useTranslations("common");
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const pages: Command[] = ALL_NAV_ITEMS.map((item) => ({
      id: item.href,
      title: t(`${item.id}.title`),
      hint: item.soon ? common("soon") : t(`${item.id}.description`),
      icon: item.icon,
      disabled: item.soon,
      run: () => router.push(item.href),
    }));
    return [
      ...pages,
      {
        id: "theme",
        title: resolvedTheme === "dark" ? tp("lightMode") : tp("darkMode"),
        hint: tp("appearance"),
        icon: Moon,
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
    ];
  }, [router, resolvedTheme, setTheme, t, tp, common]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const item = ALL_NAV_ITEMS.find((i) => i.href === c.id);
      return [c.title, c.hint, ...(item?.keywords ?? [])].some((t) => t.toLowerCase().includes(q));
    });
  }, [commands, query]);

  const run = (command: Command | undefined) => {
    if (!command || command.disabled) return;
    onOpenChange(false);
    setQuery("");
    command.run();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery("");
        setActive(0);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed top-[15vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[active]);
            }
          }}
        >
          <Dialog.Title className="sr-only">{tp("title")}</Dialog.Title>
          <Dialog.Description className="sr-only">{tp("description")}</Dialog.Description>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={tp("placeholder")}
              aria-label={tp("title")}
              className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">{tp("empty")}</li>
            )}
            {results.map((c, i) => {
              const Icon = c.icon;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={c.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(c)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                      i === active && "bg-accent",
                      c.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-primary" />
                    <span className="font-medium">{c.title}</span>
                    <span className="truncate text-muted-foreground">{c.hint}</span>
                    {i === active && !c.disabled && (
                      <CornerDownLeft className="ml-auto size-4 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
