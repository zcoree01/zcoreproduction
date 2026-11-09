import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { listGrantablePermissions, listRolesWithPermissions } from "@/modules/roles/queries";
import { RoleEditor } from "./role-editor";

// Roles and permissions (D-046): system roles read-only, custom roles
// created (empty or as a copy), changed and archived. roles.manage.

export default function RolesPage({ searchParams }: PageProps<"/settings/roles">) {
  return (
    <PageSuspense>
      <RolesContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function RolesContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tRoles, access] = await Promise.all([
    getTranslations("rolesEditor"),
    getTranslations("roles"),
    getMemberAccess(member),
  ]);
  if (!access.permissions.has("roles.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const [roles, permissions] = await Promise.all([
    listRolesWithPermissions(organizationId),
    listGrantablePermissions(access.modules.has("platform")),
  ]);
  const params = await searchParams;
  const selected = z.uuid().safeParse(firstParam(params.role));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RoleEditor
        roles={roles.map((role) => ({
          ...role,
          label: isSystemRoleKey(role.key) ? tRoles(role.key) : role.name,
        }))}
        permissions={permissions}
        enabledModules={[...access.modules]}
        selectedId={selected.success ? selected.data : (roles[0]?.id ?? null)}
      />
    </div>
  );
}
