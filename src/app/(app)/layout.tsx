import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { AppSplash } from "@/components/shared/app-splash";
import { HelpButton } from "@/components/shared/problem-report/help-button";
import { TextSizeMarker } from "@/components/shared/text-size-marker";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getMemberAccess } from "@/lib/auth/access";
import { canUseManagementApp, FLOOR_HOME } from "@/lib/auth/home";
import { CHANGE_PASSWORD_PATH } from "@/lib/auth/route-guard";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import { getNavigation } from "@/lib/navigation/server";
import { listPendingRequests } from "@/modules/attendance/absence-queries";
import { listAttendanceAlerts } from "@/modules/attendance/queries";
import { getNotificationState } from "@/modules/notifications/queries";
import { listPendingCloseRequests } from "@/modules/production-reporting/queries";
import { recordMemberActivityAfterResponse } from "@/modules/support/problem-reports/activity";
import { getCurrentSupportSession, listPendingSupportRequests } from "@/modules/support/queries";
import { AppSidebar } from "./app-sidebar";
import { CloseRequestBell } from "./close-request-bell";
import { SiteHeader } from "./site-header";
import { BillingNoticeBanner } from "@/components/shared/billing-notice";
import { SupportBanner } from "./support-banner";
import { SupportRequestPrompt } from "./support-request-prompt";

// Management app (desktop-first). Session-dependent UI streams behind Suspense.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

// Zcore loader (as on www.zcore.ba) until the shell (member, navigation) is ready.
function ShellFallback() {
  return <AppSplash />;
}

async function AppShell({ children }: { children: ReactNode }) {
  const member = await requireMember();
  // Also when rendered by a server-action redirect, which skips the proxy.
  if (member.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
  if (!canUseManagementApp(member.role.key)) redirect(FLOOR_HOME);

  const [t, groups, cookieStore, access] = await Promise.all([
    getTranslations(),
    getNavigation(member, "app"),
    cookies(),
    getMemberAccess(member),
  ]);
  // Notification bell: requests to close with a shortage (approvers),
  // attendance alerts (attendance.manage) and requests to decide (leave,
  // sick leave, corrections).
  const approver =
    access.modules.has("production") && access.permissions.has("orders.close.approve");
  const attendanceManager =
    access.modules.has("attendance") && access.permissions.has("attendance.manage");
  const decider =
    access.modules.has("attendance") &&
    (access.permissions.has("absences.manage") || access.permissions.has("attendance.manage"));
  // Problem reports: every member of a firm (not Zcore itself, not the support
  // account); the member's activity is recorded after the response.
  const inFirm = !access.modules.has("platform") && !member.isSupport;
  if (inFirm) {
    await recordMemberActivityAfterResponse(member.organization.id);
  }
  // Zcore answers problem reports: new reports and replies of users go to its bell.
  const zcoreReports =
    access.modules.has("platform") && access.permissions.has("platform.reports.manage");
  const bell = approver || attendanceManager || decider || inFirm || zcoreReports;
  const [pendingCloses, attendanceAlerts, approvals, notificationState] = await Promise.all([
    approver ? listPendingCloseRequests(member.organization.id) : Promise.resolve([]),
    attendanceManager ? listAttendanceAlerts(member.organization.id) : Promise.resolve([]),
    decider
      ? listPendingRequests(member.organization.id)
      : Promise.resolve({ absences: [], interruptions: [], corrections: [] }),
    bell
      ? getNotificationState(member.organization.id)
      : Promise.resolve({ read: [], dismissed: [] }),
  ]);
  // Zcore support account: banner with the end of the approved time.
  const supportSession = member.isSupport
    ? await getCurrentSupportSession(member.organization.id)
    : null;
  // Admins / directors answer Zcore support requests in a dialog (D-028).
  const supportApprover =
    !member.isSupport &&
    !access.modules.has("platform") &&
    access.permissions.has("support.approve");
  const pendingSupport = supportApprover
    ? await listPendingSupportRequests(member.organization.id)
    : [];
  const roleLabel = isSystemRoleKey(member.role.key)
    ? t(`roles.${member.role.key}`)
    : member.role.name;

  return (
    <SidebarProvider
      defaultOpen={cookieStore.get("sidebar_state")?.value !== "false"}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as CSSProperties
      }
    >
      <TextSizeMarker size={member.preferences.textSize} />
      <AppSidebar
        variant="inset"
        organizationName={member.organization.name}
        groups={groups}
        user={{
          name: member.fullName ?? member.username,
          username: member.username,
          roleLabel,
        }}
      />
      <SidebarInset>
        {supportApprover ? <SupportRequestPrompt initial={pendingSupport} /> : null}
        <BillingNoticeBanner notice={access.notice} timezone={member.organization.timezone} />
        {supportSession ? (
          <SupportBanner
            requestId={supportSession.id}
            approvedUntil={supportSession.approvedUntil}
            requesterName={supportSession.requesterName}
          />
        ) : null}
        <SiteHeader
          organizationName={member.organization.name}
          groups={groups}
          actions={
            <>
              {inFirm ? <HelpButton /> : null}
              {bell ? (
                <CloseRequestBell
                  initial={pendingCloses}
                  initialAlerts={attendanceAlerts}
                  initialApprovals={approvals}
                  initialState={notificationState}
                  closes={approver}
                  attendance={attendanceManager}
                  approvals={decider}
                  reports={inFirm}
                  zcoreReports={zcoreReports}
                />
              ) : null}
            </>
          }
        />
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
