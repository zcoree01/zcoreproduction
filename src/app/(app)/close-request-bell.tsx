"use client";

import { BellIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDecimal } from "@/lib/decimal";
import { pendingRequestsAction } from "@/modules/attendance/absence-actions";
import type { PendingRequests } from "@/modules/attendance/absence-queries";
import { pendingAttendanceAlertsAction } from "@/modules/attendance/actions";
import type { AttendanceAlert } from "@/modules/attendance/queries";
import { pendingCloseRequestsAction } from "@/modules/production-reporting/actions";
import type { PendingCloseRequest } from "@/modules/production-reporting/queries";

const POLL_MS = 30_000;

/**
 * Notification bell: requests to close an order with a shortage (approvers)
 * attendance alerts (automatic clock-out / clock-in, attendance.manage) and
 * leave / sick-leave / correction requests waiting for the caller's decision.
 * Refreshed every 30 s, on navigation and when the window gets focus; a new
 * item also shows a toast with a link.
 */
export function CloseRequestBell({
  initial,
  initialAlerts,
  initialApprovals,
  closes,
  attendance,
  approvals: approver,
}: {
  initial: PendingCloseRequest[];
  initialAlerts: AttendanceAlert[];
  initialApprovals: PendingRequests;
  closes: boolean;
  attendance: boolean;
  approvals: boolean;
}) {
  const t = useTranslations("notifications");
  const tUnits = useTranslations("productUnits");
  const pathname = usePathname();
  const router = useRouter();
  const [requests, setRequests] = useState(initial);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [approvals, setApprovals] = useState(initialApprovals);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    const announce = (
      list: PendingCloseRequest[],
      alertList: AttendanceAlert[],
      approvalList: PendingRequests,
    ) => {
      const known = seen.current ?? new Set<string>();
      for (const item of [
        ...approvalList.absences,
        ...approvalList.interruptions,
        ...approvalList.corrections,
      ]) {
        if (known.has(item.id)) continue;
        toast.info(t("approvalToast", { name: item.employeeName }), {
          id: item.id,
          action: { label: t("open"), onClick: () => router.push("/attendance/requests") },
        });
      }
      for (const alert of alertList) {
        if (known.has(alert.id)) continue;
        toast.warning(t(`attendanceToast.${alert.kind}`, { name: alert.employeeName }), {
          id: alert.id,
          action: { label: t("open"), onClick: () => router.push("/attendance") },
        });
      }
      for (const request of list) {
        if (known.has(request.requestId)) continue;
        toast.warning(t("newToast", { number: request.orderNumber }), {
          id: request.requestId,
          action: {
            label: t("open"),
            onClick: () => router.push(`/orders/${request.orderId}?tab=production`),
          },
        });
      }
      seen.current = new Set([
        ...list.map((request) => request.requestId),
        ...alertList.map((alert) => alert.id),
        ...approvalList.absences.map((item) => item.id),
        ...approvalList.interruptions.map((item) => item.id),
        ...approvalList.corrections.map((item) => item.id),
      ]);
    };
    const refresh = async () => {
      try {
        const [list, alertList, approvalList] = await Promise.all([
          closes ? pendingCloseRequestsAction() : Promise.resolve([]),
          attendance ? pendingAttendanceAlertsAction() : Promise.resolve([]),
          approver
            ? pendingRequestsAction()
            : Promise.resolve({ absences: [], interruptions: [], corrections: [] }),
        ]);
        if (!active) return;
        setRequests(list);
        setAlerts(alertList);
        setApprovals(approvalList);
        announce(list, alertList, approvalList);
      } catch {
        // Offline or signed out: keep the last list; the next poll retries.
      }
    };
    if (seen.current === null) announce(initial, initialAlerts, initialApprovals);
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname, initial, initialAlerts, initialApprovals, closes, attendance, approver, router, t]);

  const approvalItems = [
    ...approvals.absences.map((item) => ({
      id: item.id,
      name: item.employeeName,
      label: t(`approvalKinds.${item.kind}`),
    })),
    ...approvals.interruptions.map((item) => ({
      id: item.id,
      name: item.employeeName,
      label: t("approvalKinds.interruption"),
    })),
    ...approvals.corrections.map((item) => ({
      id: item.id,
      name: item.employeeName,
      label: t("approvalKinds.correction"),
    })),
  ];
  const count = requests.length + alerts.length + approvalItems.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={count > 0 ? `${t("label")}: ${count}` : t("label")}
            data-testid="notification-bell"
          />
        }
      >
        <BellIcon />
        {count > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white tabular-nums">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {count === 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
            <p className="px-2 py-3 text-sm text-muted-foreground">{t("empty")}</p>
          </DropdownMenuGroup>
        ) : null}
        {approvalItems.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("approvalsTitle")}</DropdownMenuLabel>
            {approvalItems.map((item) => (
              <DropdownMenuItem
                key={item.id}
                render={<Link href="/attendance/requests" />}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        {alerts.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("attendanceTitle")}</DropdownMenuLabel>
            {alerts.map((alert) => (
              <DropdownMenuItem
                key={alert.id}
                render={<Link href="/attendance" />}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium">{alert.employeeName}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`attendanceKinds.${alert.kind}`)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        {requests.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("closeTitle")}</DropdownMenuLabel>
            {requests.map((request) => (
              <DropdownMenuItem
                key={request.requestId}
                render={<Link href={`/orders/${request.orderId}?tab=production`} />}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium">
                  {t("closeItem", {
                    number: request.orderNumber,
                    good: formatDecimal(request.good),
                    quantity: formatDecimal(request.quantity),
                    unit: tUnits(request.unit),
                  })}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {t("closeBy", { name: request.requestedBy ?? "—", reason: request.reason })}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
