import { ShieldAlertIcon, UsersIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/require-permission";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import { listAssignableRoles, listMembers } from "@/modules/users/queries";
import { CreateUserForm } from "./create-user-form";

export default function UsersPage() {
  return (
    <PageSuspense>
      <UsersContent />
    </PageSuspense>
  );
}

async function UsersContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const t = await getTranslations();

  const [canRead, canManage] = await Promise.all([
    hasPermission(organizationId, "users.read"),
    hasPermission(organizationId, "users.manage"),
  ]);

  if (!canRead) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon />}
        title={t("users.deniedTitle")}
        description={t("users.deniedDescription")}
      />
    );
  }

  const [members, roles] = await Promise.all([
    listMembers(organizationId),
    canManage ? listAssignableRoles(organizationId) : Promise.resolve([]),
  ]);
  const roleLabel = (role: { key: string; name: string }) =>
    isSystemRoleKey(role.key) ? t(`roles.${role.key}`) : role.name;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("users.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("users.description")}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          {members.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title={t("users.emptyTitle")}
              description={t("users.emptyDescription")}
            />
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("users.columns.username")}</TableHead>
                    <TableHead>{t("users.columns.fullName")}</TableHead>
                    <TableHead>{t("users.columns.role")}</TableHead>
                    <TableHead>{t("users.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell className="font-mono text-sm">{row.username}</TableCell>
                      <TableCell>{row.fullName ?? "—"}</TableCell>
                      <TableCell>{roleLabel(row.role)}</TableCell>
                      <TableCell className={row.active ? "" : "text-muted-foreground"}>
                        {t(row.active ? "users.status.active" : "users.status.inactive")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t("users.form.title")}</h2>
              </CardTitle>
              <CardDescription>{t("users.form.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateUserForm
                roles={roles.map((role) => ({ id: role.id, label: roleLabel(role) }))}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
