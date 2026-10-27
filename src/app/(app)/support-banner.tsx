"use client";

import { ShieldAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/modules/auth/actions";
import { endSupportAction } from "@/modules/support/actions";

/** Shown to the Zcore support account: who, until when, and how to end it. */
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
  const format = useFormatter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm"
    >
      <ShieldAlertIcon className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
      <span>
        {t("text", {
          name: requesterName,
          time: format.dateTime(new Date(approvedUntil), { timeStyle: "short" }),
        })}
      </span>
      <Button
        size="sm"
        variant="destructive"
        className="ml-auto"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await endSupportAction(requestId);
            await signOutAction();
          })
        }
      >
        {t("end")}
      </Button>
    </div>
  );
}
