import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { isSystemRoleKey } from "@/lib/auth/roles";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { listCatalogOptions } from "@/modules/catalogs/queries";
import { parseEmployeeListParams } from "@/modules/employees/list-params";
import { listEmployeesPage, listLinkableUsers } from "@/modules/employees/queries";
import { listMachineOptions } from "@/modules/machines/queries";
import { listAssignableRoles } from "@/modules/users/queries";
import { CreateEmployeeButton, type EmployeeFormOptions } from "./employee-sheet";
import { EmployeesTable } from "./employees-table";

export default function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  return (
    <PageSuspense>
      <EmployeesContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function EmployeesContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tRoot, access] = await Promise.all([
    getTranslations("employees"),
    getTranslations(),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("employees.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const canManage = access.permissions.has("employees.manage");
  // Accounts for new workers right from the employee form (also needs users.manage).
  const canCreateAccounts = canManage && access.permissions.has("users.manage");

  const params = parseEmployeeListParams(await searchParams);
  const [page, catalogs, machines, users, roles] = await Promise.all([
    listEmployeesPage(organizationId, params),
    listCatalogOptions(organizationId, ["department", "job_title", "skill"]),
    canManage ? listMachineOptions(organizationId) : Promise.resolve([]),
    canManage ? listLinkableUsers(organizationId) : Promise.resolve([]),
    canCreateAccounts ? listAssignableRoles(organizationId) : Promise.resolve([]),
  ]);
  const options: EmployeeFormOptions = {
    departments: catalogs.department,
    jobTitles: catalogs.job_title,
    skills: catalogs.skill,
    machines,
    users,
    roles: roles.map((role) => ({
      id: role.id,
      key: role.key,
      label: isSystemRoleKey(role.key) ? tRoot(`roles.${role.key}`) : role.name,
    })),
    canCreateAccounts,
    organizationName: member.organization.name,
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={canManage ? <CreateEmployeeButton options={options} /> : null}
      />
      <EmployeesTable
        rows={page.rows}
        total={page.total}
        params={{
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          department: params.department ?? "",
          skill: params.skill ?? "",
          status: params.status ?? "",
          view: params.view ?? "",
        }}
        options={options}
        canManage={canManage}
      />
    </>
  );
}
