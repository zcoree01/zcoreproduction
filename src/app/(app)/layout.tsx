import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { canUseManagementApp, FLOOR_HOME } from "@/lib/auth/home";
import { hasPermission } from "@/lib/auth/require-permission";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import { AppNav } from "./app-nav";

// Management app (desktop-first). Session-dependent UI streams behind Suspense.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<ShellFallback />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </div>
  );
}

async function ShellFallback() {
  const t = await getTranslations("common");
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageSkeleton label={t("loading")} />
    </main>
  );
}

async function AppShell({ children }: { children: ReactNode }) {
  const member = await requireMember();
  if (!canUseManagementApp(member.role.key)) redirect(FLOOR_HOME);

  const [t, canSeeUsers] = await Promise.all([
    getTranslations(),
    hasPermission(member.organization.id, "users.read"),
  ]);
  const roleLabel = isSystemRoleKey(member.role.key)
    ? t(`roles.${member.role.key}`)
    : member.role.name;

  return (
    <>
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <span className="font-semibold">{member.organization.name}</span>
          <AppNav
            items={[
              { href: "/dashboard", label: t("nav.dashboard") },
              ...(canSeeUsers ? [{ href: "/admin/users", label: t("nav.users") }] : []),
            ]}
          />
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right text-sm leading-tight">
              <div className="font-medium">{member.fullName ?? member.username}</div>
              <div className="text-muted-foreground">{roleLabel}</div>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </>
  );
}
