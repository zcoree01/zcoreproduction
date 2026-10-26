"use client";

import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveAlertAction } from "@/modules/attendance/actions";
import type { AttendanceAlert } from "@/modules/attendance/queries";

type Row = AttendanceAlert & { clockIn: string; clockOut: string | null };

/** Alerts to check with the worker; "Provjereno" with an optional note closes them. */
export function AlertList({ alerts }: { alerts: Row[] }) {
  const t = useTranslations("attendanceBoard");
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => (
        <AlertItem key={alert.id} alert={alert} t={t} />
      ))}
    </ul>
  );
}

function AlertItem({
  alert,
  t,
}: {
  alert: Row;
  t: ReturnType<typeof useTranslations<"attendanceBoard">>;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const resolve = () =>
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof resolveAlertAction>>;
      try {
        result = await resolveAlertAction(alert.id, { note });
      } catch {
        toast.error(t("errors.offline"));
        return;
      }
      if (result.ok) {
        toast.success(t("resolvedToast", { name: alert.employeeName }));
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center"
      data-testid="attendance-alert"
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="font-medium">
          {alert.employeeName} · {t(`alertKinds.${alert.kind}`)}
        </span>
        <span className="text-sm text-muted-foreground">
          {alert.kind === "auto_clock_out"
            ? t("alertAutoOut", { in: alert.clockIn, out: alert.clockOut ?? "" })
            : t("alertAutoIn", { in: alert.clockIn })}
        </span>
      </div>
      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t("notePlaceholder")}
        aria-label={t("notePlaceholder")}
        maxLength={500}
        className="sm:w-64"
      />
      <Button onClick={resolve} disabled={pending} variant="outline">
        <CheckIcon />
        {t("resolve")}
      </Button>
    </li>
  );
}
