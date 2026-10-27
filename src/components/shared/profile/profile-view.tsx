import { LogOutIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PasswordForm } from "@/components/shared/password-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSystemRoleKey } from "@/lib/auth/roles";
import type { CurrentMember } from "@/lib/auth/session";
import { signOutAction } from "@/modules/auth/actions";
import { getMyEmployee } from "@/modules/profile/queries";
import { AppearanceSettings } from "./appearance-settings";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium sm:text-right">{children}</dd>
    </div>
  );
}

/** "Moj profil": same content in the management app and on the shop floor. */
export async function ProfileView({ member }: { member: CurrentMember }) {
  const [t, employee] = await Promise.all([getTranslations(), getMyEmployee(member)]);
  const roleLabel = isSystemRoleKey(member.role.key)
    ? t(`roles.${member.role.key}`)
    : member.role.name;
  const none = <span className="text-muted-foreground">—</span>;

  return (
    <div className="grid w-full max-w-2xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.details.title")}</CardTitle>
          <CardDescription>{t("profile.details.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label={t("profile.details.fullName")}>{member.fullName ?? none}</Row>
            <Row label={t("profile.details.username")}>
              <span className="font-mono">{member.username}</span>
            </Row>
            <Row label={t("profile.details.role")}>{roleLabel}</Row>
            <Row label={t("profile.details.organization")}>{member.organization.name}</Row>
            {employee ? (
              <>
                <Row label={t("profile.details.employeeNumber")}>{employee.employeeNumber}</Row>
                <Row label={t("profile.details.department")}>{employee.department ?? none}</Row>
                <Row label={t("profile.details.jobTitle")}>{employee.jobTitle ?? none}</Row>
                <Row label={t("profile.details.machines")}>
                  {employee.machines.length > 0
                    ? employee.machines.map((m) => `${m.code} · ${m.name}`).join(", ")
                    : none}
                </Row>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.password.title")}</CardTitle>
          <CardDescription>{t("profile.password.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm mode="change" username={member.username} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.appearance.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AppearanceSettings textSize={member.preferences.textSize} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.session.title")}</CardTitle>
          <CardDescription>{t("profile.session.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" className="h-12 w-full sm:w-auto">
              <LogOutIcon />
              {t("common.signOut")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
