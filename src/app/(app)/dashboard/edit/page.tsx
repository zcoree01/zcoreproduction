import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import { firstParam } from "@/lib/data-table/params";
import {
  getRoleLayout,
  listDashboardRoles,
  listRolePermissions,
} from "@/modules/dashboard/queries";
import { LayoutEditor } from "./layout-editor";

export default function DashboardEditPage({ searchParams }: PageProps<"/dashboard/edit">) {
  return (
    <PageSuspense>
      <DashboardEditContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function DashboardEditContent({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard/edit">["searchParams"];
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tRoot, access] = await Promise.all([
    getTranslations("dashboard.editor"),
    getTranslations(),
    getMemberAccess(member),
  ]);
  if (!access.permissions.has("dashboard.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const roles = (await listDashboardRoles(organizationId)).map((role) => ({
    ...role,
    label: isSystemRoleKey(role.key) ? tRoot(`roles.${role.key}`) : role.name,
  }));
  const requested = z.uuid().safeParse(firstParam((await searchParams).role));
  const role =
    roles.find((item) => requested.success && item.id === requested.data) ??
    roles.find((item) => item.id === member.role.id) ??
    roles[0];
  if (!role) return <PermissionDenied description={t("deniedDescription")} />;

  const [layout, permissions] = await Promise.all([
    getRoleLayout(organizationId, role),
    listRolePermissions(organizationId, role.id),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <LayoutEditor
        key={role.id}
        roles={roles.map((item) => ({ id: item.id, label: item.label }))}
        roleId={role.id}
        roleLabel={role.label}
        initialWidgets={layout.widgets}
        custom={layout.custom}
        rolePermissions={permissions}
        modules={[...access.modules]}
      />
    </>
  );
}
