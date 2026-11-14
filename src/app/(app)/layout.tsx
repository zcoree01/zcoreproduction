import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { AppSplash } from "@/components/shared/app-splash";
import { NotificationLive } from "@/components/shared/notification-live";
import { OrgTimeZoneProvider } from "@/components/shared/org-time-zone-provider";
import { HelpButton } from "@/components/shared/problem-report/help-button";
import { ScopedIntlProvider } from "@/components/shared/scoped-intl-provider";
import { TextSizeMarker } from "@/components/shared/text-size-marker";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getMemberAccess } from "@/lib/auth/access";
import { canUseManagementApp, FLOOR_HOME } from "@/lib/auth/home";
import { CHANGE_PASSWORD_PATH } from "@/lib/auth/route-guard";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import { getNavigation } from "@/lib/navigation/server";
import { recordMemberActivityAfterResponse } from "@/modules/support/problem-reports/activity";
import { notificationScopes } from "@/modules/notifications/feed";
import { getCurrentSupportSession } from "@/modules/support/queries";
import { AppSidebar } from "./app-sidebar";
import { CloseRequestBell } from "./close-request-bell";
import { SiteHeader } from "./site-header";
import { BillingNoticeBanner } from "@/components/shared/billing-notice";
import { SupportBanner } from "./support-banner";
import { SupportRequestPrompt } from "./support-request-prompt";

// Management app (desktop-first). Session-dependent UI streams behind Suspense.
export default function AppLayout({ children }: { children: ReactNode }) {
  // Every message: the management app uses nearly all namespaces.
  return (
    <ScopedIntlProvider>
      <Suspense fallback={<ShellFallback />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </ScopedIntlProvider>
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
  // Problem reports: every member of a firm (not Zcore itself, not the support
  // account); the member's activity is recorded after the response.
  const inFirm = !access.modules.has("platform") && !member.isSupport;
  // The bell, the "?" button and the support prompt load their items
  // themselves after the page (/api/notifications, D-054), so the shell and
  // the page behind it do not wait for them.
  const scopes = notificationScopes(member, access);
  const bell =
    scopes.closes || scopes.attendance || scopes.approvals || scopes.reports || scopes.zcoreReports;
  // Zcore support account: banner with the end of the approved time.
  const [supportSession] = await Promise.all([
    member.isSupport ? getCurrentSupportSession(member.organization.id) : null,
    inFirm ? recordMemberActivityAfterResponse(member.organization.id) : null,
  ]);
  const roleLabel = isSystemRoleKey(member.role.key)
    ? t(`roles.${member.role.key}`)
    : member.role.name;

  return (
    <OrgTimeZoneProvider timeZone={member.organization.timezone}>
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
          {bell || scopes.support ? (
            <NotificationLive organizationId={member.organization.id} />
          ) : null}
          {scopes.support ? <SupportRequestPrompt /> : null}
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
                {bell ? <CloseRequestBell /> : null}
              </>
            }
          />
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </OrgTimeZoneProvider>
  );
}
