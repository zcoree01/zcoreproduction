import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { zonedDate } from "@/lib/timezone";
import { listCustomerOptions } from "@/modules/customers/queries";
import { parseOrderListParams } from "@/modules/production-orders/list-params";
import {
  getOrderSettings,
  listAssignmentOptions,
  listOrdersPage,
  listProductChoices,
} from "@/modules/production-orders/queries";
import { CreateOrderButton } from "./order-sheet";
import { OrdersTable } from "./orders-table";

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <PageSuspense>
      <OrdersContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function OrdersContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("orders"), getMemberAccess(member)]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("orders.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const canManage = access.permissions.has("orders.manage");

  const params = parseOrderListParams(await searchParams);
  const [page, customers, options, products, settings] = await Promise.all([
    listOrdersPage(organizationId, params),
    listCustomerOptions(organizationId),
    listAssignmentOptions(organizationId),
    canManage ? listProductChoices(organizationId) : Promise.resolve([]),
    getOrderSettings(organizationId),
  ]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage ? (
            <CreateOrderButton
              options={{
                customers,
                products,
                priorityMode: settings.priorityMode,
                today: zonedDate(new Date(), member.organization.timezone),
              }}
            />
          ) : null
        }
      />
      <OrdersTable
        rows={page.rows}
        total={page.total}
        params={{
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          status: params.status ?? "",
          priority: params.priority ?? "",
          customer: params.customer ?? "",
          machine: params.machine ?? "",
          due: params.due ?? "",
        }}
        customers={customers}
        machines={options.machines}
        priorityMode={settings.priorityMode}
      />
    </>
  );
}
