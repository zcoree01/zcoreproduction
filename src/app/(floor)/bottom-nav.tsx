"use client";

import { LogOutIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { NavIcon } from "@/components/shared/nav-icon";
import { activeNavItem } from "@/lib/navigation/registry";
import type { NavLink } from "@/lib/navigation/server";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/modules/auth/actions";

// shadcn has no bottom navigation component; this is a thin Tailwind bar
// (64px, 48px+ touch targets, safe-area aware) for workers on phones.
const ITEM_CLASS =
  "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors";

export function BottomNav({ items }: { items: NavLink[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeNavItem(items, pathname);

  return (
    <nav
      aria-label={t("nav.floorNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/80"
    >
      <div className="mx-auto flex h-16 max-w-xl items-stretch gap-2 px-2 py-2">
        {items.map((item) => {
          const isActive = active?.id === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                ITEM_CLASS,
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <NavIcon icon={item.icon} className="size-5" />
              {item.label}
            </Link>
          );
        })}
        <ConfirmDialog
          trigger={
            <button
              type="button"
              className={cn(ITEM_CLASS, "text-muted-foreground hover:text-foreground")}
            >
              <LogOutIcon className="size-5" aria-hidden />
              {t("common.signOut")}
            </button>
          }
          title={t("floor.signOutTitle")}
          description={t("floor.signOutDescription")}
          confirmLabel={t("common.signOut")}
          onConfirm={() => signOutAction()}
        />
      </div>
    </nav>
  );
}
