import "server-only";
import type { MemberAccess } from "@/lib/auth/access";
import { permitAction } from "@/lib/auth/require-permission";
import type { CurrentMember } from "@/lib/auth/session";
import { listPendingRequests, type PendingRequests } from "@/modules/attendance/absence-queries";
import { listAttendanceAlerts, type AttendanceAlert } from "@/modules/attendance/queries";
import { listZcoreReportNotices, type ZcoreReportNotice } from "@/modules/platform/reports-queries";
import {
  listPendingCloseRequests,
  type PendingCloseRequest,
} from "@/modules/production-reporting/queries";
import { listReportNotices } from "@/modules/support/problem-reports/queries";
import type { ReportNotice } from "@/modules/support/problem-reports/types";
import { listPendingSupportRequests, type PendingSupportRequest } from "@/modules/support/queries";
import { PLATFORM_SLUG } from "@/modules/support/schemas";
import { getNotificationState } from "./queries";
import type { NotificationState } from "./rules";

/** Which notification groups the member gets (the layouts show the same ones). */
export type NotificationScopes = {
  /** Requests to close an order with a shortage (orders.close.approve). */
  closes: boolean;
  /** Attendance alerts (attendance.manage). */
  attendance: boolean;
  /** Leave, sick-leave and correction requests to decide. */
  approvals: boolean;
  /** Replies of Zcore support to the member's own problem reports. */
  reports: boolean;
  /** New problem reports and user replies (Zcore organization only). */
  zcoreReports: boolean;
  /** Zcore support access requests to approve (D-028). */
  support: boolean;
};

/** Everything the bell, the "?" button and the support prompt poll, in one answer (D-054). */
export type NotificationFeed = {
  closes: PendingCloseRequest[];
  alerts: AttendanceAlert[];
  approvals: PendingRequests;
  state: NotificationState;
  notices: ReportNotice[];
  zcoreNotices: ZcoreReportNotice[];
  supportRequests: PendingSupportRequest[];
};

export function notificationScopes(
  member: CurrentMember,
  access: MemberAccess,
): NotificationScopes {
  const platform = access.modules.has("platform");
  const attendance = access.modules.has("attendance");
  return {
    closes: access.modules.has("production") && access.permissions.has("orders.close.approve"),
    attendance: attendance && access.permissions.has("attendance.manage"),
    approvals:
      attendance &&
      (access.permissions.has("absences.manage") || access.permissions.has("attendance.manage")),
    reports: !platform && !member.isSupport,
    zcoreReports: platform && access.permissions.has("platform.reports.manage"),
    support: !member.isSupport && !platform && access.permissions.has("support.approve"),
  };
}

/**
 * The member's notifications, all read in parallel. Every list goes through
 * RLS as the member; only the Zcore list uses the service role, so it is
 * re-checked in the database and limited to the Zcore organization.
 */
export async function loadNotificationFeed(
  member: CurrentMember,
  access: MemberAccess,
): Promise<NotificationFeed> {
  const organizationId = member.organization.id;
  const scopes = notificationScopes(member, access);
  const [closes, alerts, approvals, state, notices, zcoreNotices, supportRequests] =
    await Promise.all([
      scopes.closes ? listPendingCloseRequests(organizationId) : [],
      scopes.attendance ? listAttendanceAlerts(organizationId) : [],
      scopes.approvals
        ? listPendingRequests(organizationId)
        : { absences: [], interruptions: [], corrections: [] },
      getNotificationState(organizationId),
      scopes.reports ? listReportNotices(organizationId) : [],
      scopes.zcoreReports && member.organization.slug === PLATFORM_SLUG
        ? permitAction(organizationId, "platform.reports.manage").then((allowed) =>
            allowed ? listZcoreReportNotices() : [],
          )
        : [],
      scopes.support
        ? listPendingSupportRequests(organizationId).catch((error: unknown) => {
            console.error("pending support requests failed", error);
            return [];
          })
        : [],
    ]);
  return { closes, alerts, approvals, state, notices, zcoreNotices, supportRequests };
}
