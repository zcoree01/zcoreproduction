"use client";

import { BellIcon, CheckCheckIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  OPEN_MY_REPORTS_EVENT,
  REPORT_NOTICES_CHANGED_EVENT,
} from "@/components/shared/problem-report/events";
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { pendingRequestsAction } from "@/modules/attendance/absence-actions";
import type { PendingRequests } from "@/modules/attendance/absence-queries";
import { pendingAttendanceAlertsAction } from "@/modules/attendance/actions";
import type { AttendanceAlert } from "@/modules/attendance/queries";
import { markNotificationsAction, notificationStateAction } from "@/modules/notifications/actions";
import {
  bellItems,
  itemsToAnnounce,
  notificationKey,
  unreadCount,
  type BellItem,
  type BellSource,
  type NotificationState,
} from "@/modules/notifications/rules";
import { pendingCloseRequestsAction } from "@/modules/production-reporting/actions";
import type { PendingCloseRequest } from "@/modules/production-reporting/queries";
import { zcoreReportNoticesAction } from "@/modules/platform/reports-actions";
import type { ZcoreReportNotice } from "@/modules/platform/reports-queries";
import { reportNoticesAction } from "@/modules/support/problem-reports/actions";
import type { ReportNotice } from "@/modules/support/problem-reports/types";

const POLL_MS = 30_000;
const GROUPS = ["zcore", "reports", "approvals", "attendance", "close"] as const;

/**
 * Notification bell (D-038): requests to close an order with a shortage
 * (approvers), attendance alerts (attendance.manage) and leave / sick-leave /
 * correction requests waiting for the caller's decision. Refreshed every
 * 30 s, on navigation and when the window gets focus. A new unread item pops
 * up for 10 s with "Otvori" and ✕; in the bell every item opens on click and has ✕,
 * and "Označi sve kao pročitano" clears the counter. Read / removed is kept
 * per user; the pending work itself stays until it is decided.
 */
export function CloseRequestBell({
  initial,
  initialAlerts,
  initialApprovals,
  initialState,
  closes,
  attendance,
  approvals: approver,
  reports: reporter,
  zcoreReports: zcore,
}: {
  initial: PendingCloseRequest[];
  initialAlerts: AttendanceAlert[];
  initialApprovals: PendingRequests;
  initialState: NotificationState;
  closes: boolean;
  attendance: boolean;
  approvals: boolean;
  /** Replies from Zcore support and decisions on proposed sessions (every firm member). */
  reports: boolean;
  /** New problem reports and user replies (Zcore organization, platform.reports.manage). */
  zcoreReports: boolean;
}) {
  const t = useTranslations("notifications");
  const tUnits = useTranslations("productUnits");
  const pathname = usePathname();
  const router = useRouter();
  const [requests, setRequests] = useState(initial);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [notices, setNotices] = useState<ReportNotice[]>([]);
  const [zcoreNotices, setZcoreNotices] = useState<ZcoreReportNotice[]>([]);
  const [state, setState] = useState(initialState);
  const shown = useRef(new Set<string>());

  const sources = useMemo<BellSource[]>(
    () => [
      ...zcoreNotices.map((notice) => ({
        key: notice.key,
        group: "zcore" as const,
        href: `/platform/reports/${notice.reportId}`,
        title: t(`zcoreReports.${notice.kind}.title`),
        detail: notice.detail,
        toast: t(`zcoreReports.${notice.kind}.toast`),
      })),
      ...notices.map((notice) => ({
        key: notice.key,
        group: "reports" as const,
        href: "#",
        title: t(`reports.${notice.kind}.title`),
        detail: notice.detail,
        toast: t(`reports.${notice.kind}.toast`),
      })),
      ...approvals.absences.map((item) => ({
        key: notificationKey("approval", item.id),
        group: "approvals" as const,
        href: "/attendance/requests",
        title: item.employeeName,
        detail: t(`approvalKinds.${item.kind}`),
        toast: t("approvalToast", { name: item.employeeName }),
      })),
      ...approvals.interruptions.map((item) => ({
        key: notificationKey("approval", item.id),
        group: "approvals" as const,
        href: "/attendance/requests",
        title: item.employeeName,
        detail: t("approvalKinds.interruption"),
        toast: t("approvalToast", { name: item.employeeName }),
      })),
      ...approvals.corrections.map((item) => ({
        key: notificationKey("approval", item.id),
        group: "approvals" as const,
        href: "/attendance/requests",
        title: item.employeeName,
        detail: t("approvalKinds.correction"),
        toast: t("approvalToast", { name: item.employeeName }),
      })),
      ...alerts.map((alert) => ({
        key: notificationKey("alert", alert.id),
        group: "attendance" as const,
        href: "/attendance",
        title: alert.employeeName,
        detail: t(`attendanceKinds.${alert.kind}`),
        toast: t(`attendanceToast.${alert.kind}`, { name: alert.employeeName }),
      })),
      ...requests.map((request) => ({
        key: notificationKey("close", request.requestId),
        group: "close" as const,
        href: `/orders/${request.orderId}?tab=production`,
        title: t("closeItem", {
          number: request.orderNumber,
          good: formatDecimal(request.good),
          quantity: formatDecimal(request.quantity),
          unit: tUnits(request.unit),
        }),
        detail: t("closeBy", { name: request.requestedBy ?? "—", reason: request.reason }),
        toast: t("newToast", { number: request.orderNumber }),
      })),
    ],
    [zcoreNotices, notices, approvals, alerts, requests, t, tUnits],
  );
  const items = useMemo(() => bellItems(sources, state), [sources, state]);
  const count = unreadCount(items);

  const mark = useCallback((keys: string[], dismiss: boolean) => {
    if (keys.length === 0) return;
    setState((current) => ({
      read: [...new Set([...current.read, ...keys])],
      dismissed: dismiss ? [...new Set([...current.dismissed, ...keys])] : current.dismissed,
    }));
    // Best effort: on failure the item shows as unread again after a reload.
    void markNotificationsAction(keys, dismiss)
      .then(() => window.dispatchEvent(new Event(REPORT_NOTICES_CHANGED_EVENT)))
      .catch(() => undefined);
  }, []);

  const open = useCallback(
    (item: BellItem) => {
      mark([item.key], false);
      toast.dismiss(item.key);
      if (item.group === "reports") {
        window.dispatchEvent(new Event(OPEN_MY_REPORTS_EVENT));
        return;
      }
      router.push(item.href);
    },
    [mark, router],
  );

  // Pop-ups for new unread items.
  useEffect(() => {
    for (const item of itemsToAnnounce(items, shown.current)) {
      shown.current.add(item.key);
      const calm =
        item.group === "approvals" || item.group === "reports" || item.group === "zcore";
      const show = calm ? toast.info : toast.warning;
      show(item.toast, {
        id: item.key,
        description: calm ? item.detail : undefined,
        // Long enough to read and act on; the item stays in the bell.
        duration: 10_000,
        closeButton: true,
        action: { label: t("open"), onClick: () => open(item) },
        // ✕ (or a swipe) means "seen": it does not pop up again.
        onDismiss: () => mark([item.key], false),
      });
    }
  }, [items, mark, open, t]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [list, alertList, approvalList, nextState, noticeList, zcoreList] = await Promise.all([
          closes ? pendingCloseRequestsAction() : Promise.resolve([]),
          attendance ? pendingAttendanceAlertsAction() : Promise.resolve([]),
          approver
            ? pendingRequestsAction()
            : Promise.resolve({ absences: [], interruptions: [], corrections: [] }),
          notificationStateAction(),
          reporter ? reportNoticesAction() : Promise.resolve([]),
          zcore ? zcoreReportNoticesAction() : Promise.resolve([]),
        ]);
        if (!active) return;
        setNotices(noticeList);
        setZcoreNotices(zcoreList);
        setRequests(list);
        setAlerts(alertList);
        setApprovals(approvalList);
        setState((current) => ({
          read: [...new Set([...current.read, ...nextState.read])],
          dismissed: [...new Set([...current.dismissed, ...nextState.dismissed])],
        }));
      } catch {
        // Offline or signed out: keep the last list; the next poll retries.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(REPORT_NOTICES_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(REPORT_NOTICES_CHANGED_EVENT, refresh);
    };
  }, [pathname, closes, attendance, approver, reporter, zcore]);

  const titles: Record<(typeof GROUPS)[number], string> = {
    zcore: t("zcoreReportsTitle"),
    reports: t("reportsTitle"),
    approvals: t("approvalsTitle"),
    attendance: t("attendanceTitle"),
    close: t("closeTitle"),
  };

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
      <DropdownMenuContent align="end" className="w-96">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-sm font-semibold">{t("label")}</span>
          {count > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                mark(
                  items.filter((item) => !item.read).map((item) => item.key),
                  false,
                )
              }
            >
              <CheckCheckIcon />
              {t("markAllRead")}
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{t("empty")}</p>
        ) : null}
        {GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;
          return (
            <DropdownMenuGroup key={group}>
              <DropdownMenuLabel>{titles[group]}</DropdownMenuLabel>
              {groupItems.map((item) => (
                <div
                  key={item.key}
                  className="group/item flex items-start gap-1"
                  data-testid="notification-item"
                  data-read={item.read ? "true" : "false"}
                >
                  <DropdownMenuItem
                    render={<Link href={item.href} />}
                    onClick={(event) => {
                      event.preventDefault();
                      open(item);
                    }}
                    className="flex min-w-0 flex-1 items-start gap-2"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        item.read ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cn(item.read ? "font-normal" : "font-semibold")}>
                        {item.title}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                      {item.read ? null : <span className="sr-only">{t("unread")}</span>}
                    </span>
                  </DropdownMenuItem>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mt-1 shrink-0 text-muted-foreground"
                    onClick={() => {
                      toast.dismiss(item.key);
                      mark([item.key], true);
                    }}
                    aria-label={t("remove", { title: item.title })}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
