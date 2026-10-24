import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { parseCustomerListParams } from "@/modules/customers/list-params";
import { listCustomersPage } from "@/modules/customers/queries";
import { CreateCustomerButton } from "./customer-sheet";
import { CustomersTable } from "./customers-table";

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <PageSuspense>
      <CustomersContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function CustomersContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("customers"), getMemberAccess(member)]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("customers.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const canManage = access.permissions.has("customers.manage");

  const params = parseCustomerListParams(await searchParams);
  const page = await listCustomersPage(member.organization.id, params);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={canManage ? <CreateCustomerButton /> : null}
      />
      <CustomersTable
        rows={page.rows}
        total={page.total}
        params={{
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          view: params.view ?? "",
        }}
        canManage={canManage}
      />
    </>
  );
}
