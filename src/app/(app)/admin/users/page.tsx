import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { hasPermission } from "@/lib/auth/require-permission";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { parseMemberListParams } from "@/modules/users/list-params";
import { listAssignableRoles, listMembersPage } from "@/modules/users/queries";
import { CreateUserSheet } from "./create-user-sheet";
import { UsersTable } from "./users-table";

export default function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <PageSuspense>
      <UsersContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function UsersContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const t = await getTranslations();

  const [canRead, canManage] = await Promise.all([
    hasPermission(organizationId, "users.read"),
    hasPermission(organizationId, "users.manage"),
  ]);
  if (!canRead) return <PermissionDenied description={t("users.deniedDescription")} />;

  const params = parseMemberListParams(await searchParams);
  const [page, roles] = await Promise.all([
    listMembersPage(organizationId, params),
    listAssignableRoles(organizationId),
  ]);
  const roleLabel = (role: { key: string; name: string }) =>
    isSystemRoleKey(role.key) ? t(`roles.${role.key}`) : role.name;

  return (
    <>
      <PageHeader
        title={t("users.title")}
        description={t("users.description")}
        actions={
          canManage ? (
            <CreateUserSheet
              roles={roles.map((role) => ({ id: role.id, label: roleLabel(role) }))}
              organizationName={member.organization.name}
            />
          ) : null
        }
      />
      <UsersTable
        rows={page.rows.map((row) => ({
          userId: row.userId,
          username: row.username,
          fullName: row.fullName,
          roleLabel: roleLabel(row.role),
          active: row.active,
          mustChangePassword: row.mustChangePassword,
        }))}
        canManage={canManage}
        currentUserId={member.userId}
        organizationName={member.organization.name}
        total={page.total}
        page={params.page}
        pageSize={params.pageSize}
        query={params.q}
        role={params.role ?? ""}
        status={params.status ?? ""}
        roleOptions={roles.map((role) => ({ value: role.key, label: roleLabel(role) }))}
      />
    </>
  );
}
