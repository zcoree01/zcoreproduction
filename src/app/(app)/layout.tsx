import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
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
import { listPendingCloseRequests } from "@/modules/production-reporting/queries";
import { getCurrentSupportSession, listPendingSupportRequests } from "@/modules/support/queries";
import { AppSidebar } from "./app-sidebar";
import { CloseRequestBell } from "./close-request-bell";
import { SiteHeader } from "./site-header";
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

async function ShellFallback() {
  const t = await getTranslations("common");
  return (
    <div className="flex flex-1 p-6">
      <PageSkeleton label={t("loading")} />
    </div>
  );
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
  const [pendingCloses, attendanceAlerts, approvals] = await Promise.all([
    approver ? listPendingCloseRequests(member.organization.id) : Promise.resolve([]),
    attendanceManager ? listAttendanceAlerts(member.organization.id) : Promise.resolve([]),
    decider
      ? listPendingRequests(member.organization.id)
      : Promise.resolve({ absences: [], interruptions: [], corrections: [] }),
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
            approver || attendanceManager || decider ? (
              <CloseRequestBell
                initial={pendingCloses}
                initialAlerts={attendanceAlerts}
                initialApprovals={approvals}
                closes={approver}
                attendance={attendanceManager}
                approvals={decider}
              />
            ) : null
          }
        />
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
