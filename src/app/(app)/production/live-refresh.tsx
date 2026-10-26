"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_MS = 30_000;

/** Reloads the server data every 30 s (and on focus) while today is shown. */
export function LiveRefresh({ active }: { active: boolean }) {
  const t = useTranslations("productionDay");
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const refresh = () => router.refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [active, router]);
  if (!active) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
      {t("live")}
    </span>
  );
}
