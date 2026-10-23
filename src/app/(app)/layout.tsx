import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { canUseManagementApp, FLOOR_HOME } from "@/lib/auth/home";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import { getNavigation } from "@/lib/navigation/server";
import { AppSidebar } from "./app-sidebar";
import { SiteHeader } from "./site-header";

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
  if (!canUseManagementApp(member.role.key)) redirect(FLOOR_HOME);

  const [t, groups, cookieStore] = await Promise.all([
    getTranslations(),
    getNavigation(member, "app"),
    cookies(),
  ]);
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
        <SiteHeader organizationName={member.organization.name} groups={groups} />
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
