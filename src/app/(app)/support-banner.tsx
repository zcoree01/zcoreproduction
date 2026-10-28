"use client";

import { ShieldAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SUPPORT_EXIT_PATH, SUPPORT_STATUS_PATH } from "@/lib/auth/route-guard";
import { endSupportAction } from "@/modules/support/actions";

const POLL_MS = 10_000;

/** "1:05:09" / "4:07" until the end of the approved time. */
function remaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * Shown to the Zcore support account (D-028): who, a countdown to the end of
 * the approved time, and "Završi podršku". When the organization ends the
 * session or the time is up, the browser leaves through /support/exit back
 * to the platform admin's own Zcore session.
 */
export function SupportBanner({
  requestId,
  approvedUntil,
  requesterName,
}: {
  requestId: string;
  approvedUntil: string;
  requesterName: string;
}) {
  const t = useTranslations("support.banner");
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const end = new Date(approvedUntil).getTime();
  const left = end - now;

  useEffect(() => {
    const exit = () => window.location.assign(SUPPORT_EXIT_PATH);
    const tick = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= end) exit();
    }, 1000);
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(SUPPORT_STATUS_PATH, {
          cache: "no-store",
          redirect: "manual",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { ended?: boolean };
        if (body.ended) exit();
      } catch {
        // Offline: the countdown still ends the session at its time.
      }
    }, POLL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [end]);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm"
    >
      <ShieldAlertIcon className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
      <span>{t("text", { name: requesterName })}</span>
      <span className="font-mono font-semibold tabular-nums" aria-label={t("remainingLabel")}>
        {t("remaining", { time: remaining(left) })}
      </span>
      <Button
        size="sm"
        variant="destructive"
        className="ml-auto"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await endSupportAction(requestId);
            window.location.assign(SUPPORT_EXIT_PATH);
          })
        }
      >
        {t("end")}
      </Button>
    </div>
  );
}
