import {
  ArrowLeftIcon,
  BuildingIcon,
  ClipboardListIcon,
  PackageIcon,
  SearchIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { DueWarningBadge, OrderStatusBadge, PriorityBadge } from "@/components/shared/order-badges";
import { OrderProgress } from "@/components/shared/order-progress";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatDecimal } from "@/lib/decimal";
import { countryName } from "@/lib/countries";
import { getCompany, getOrganizationProfile } from "@/modules/companies/queries";
import { getCustomer } from "@/modules/customers/queries";
import {
  ORDER_STATUS_FILTERS,
  parseCustomerOrderFilters,
} from "@/modules/production-orders/list-params";
import { listCustomerOrders } from "@/modules/production-orders/queries";
import { listProductsPage } from "@/modules/products/queries";
import { CustomerActions } from "./customer-actions";
import { DirectoryCard } from "./directory-card";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  return (
    <PageSuspense>
      <CustomerContent params={params} searchParams={searchParams} />
    </PageSuspense>
  );
}

async function CustomerContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tUnits, tStatus, tPriority, access] = await Promise.all([
    getTranslations("customers"),
    getTranslations("productUnits"),
    getTranslations("orderStatus"),
    getTranslations("priority"),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("customers.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const { id } = await params;
  const customerId = z.uuid().safeParse(id);
  const customer = customerId.success ? await getCustomer(organizationId, customerId.data) : null;
  if (!customer) {
    return (
      <EmptyState
        icon={<BuildingIcon />}
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundDescription")}
        action={
          <Link href="/customers" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("detail.back")}
          </Link>
        }
      />
    );
  }

  const canReadProducts = access.permissions.has("products.read");
  const products = canReadProducts
    ? await listProductsPage(organizationId, {
        page: 1,
        pageSize: 50,
        q: "",
        customer: customer.id,
        type: undefined,
        view: undefined,
      })
    : null;
  const filters = parseCustomerOrderFilters(await searchParams);
  const filtered =
    filters.q !== "" || filters.priority !== undefined || filters.status !== undefined;
  const orders = access.permissions.has("orders.read")
    ? await listCustomerOrders(organizationId, customer.id, filters)
    : null;
  // Shared directory entry (public data, bank accounts); own company: no proposals.
  const [company, ownProfile] = customer.companyId
    ? await Promise.all([getCompany(customer.companyId), getOrganizationProfile(organizationId)])
    : [null, null];
  const ownCompanyId = ownProfile?.status === "owned" ? ownProfile.company.id : null;

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link
          href="/customers"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("detail.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("detail.number", { number: customer.number })}
            </span>
            {customer.archived ? <Badge variant="secondary">{t("detail.archived")}</Badge> : null}
          </div>
          {access.permissions.has("customers.manage") ? (
            <CustomerActions customer={customer} />
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("detail.data")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Item label={t("form.taxId")}>{customer.taxId}</Item>
            <Item label={t("form.address")}>{customer.address}</Item>
            <Item label={t("form.city")}>
              {[
                [customer.postalCode, customer.city].filter(Boolean).join(" "),
                countryName(customer.country),
              ]
                .filter(Boolean)
                .join(", ") || null}
            </Item>
            <Item label={t("form.contactPerson")}>{customer.contactPerson}</Item>
            <Item label={t("form.phone")}>{customer.phone}</Item>
            <Item label={t("form.email")}>
              {customer.email ? (
                <a href={`mailto:${customer.email}`} className="underline-offset-4 hover:underline">
                  {customer.email}
                </a>
              ) : null}
            </Item>
            <div className="sm:col-span-2">
              <Item label={t("form.notes")}>
                {customer.notes ? (
                  <span className="whitespace-pre-line">{customer.notes}</span>
                ) : null}
              </Item>
            </div>
          </dl>
        </CardContent>
      </Card>

      {company ? (
        <DirectoryCard
          company={company}
          canPropose={access.permissions.has("customers.manage") && company.id !== ownCompanyId}
        />
      ) : null}

      {orders ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.orders", { count: orders.length })}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              action={`/customers/${customer.id}`}
              role="search"
              className="flex flex-wrap items-end gap-2"
            >
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                {t("detail.filters.search")}
                <Input
                  name="q"
                  type="search"
                  defaultValue={filters.q}
                  placeholder={t("detail.filters.searchPlaceholder")}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("detail.filters.priority")}
                <NativeSelect name="priority" defaultValue={filters.priority ?? ""}>
                  <NativeSelectOption value="">{t("detail.filters.all")}</NativeSelectOption>
                  {(["1", "2", "3", "4", "5"] as const).map((level) => (
                    <NativeSelectOption key={level} value={level}>
                      {`${level} – ${tPriority(`levels.${level}`)}`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("detail.filters.status")}
                <NativeSelect name="status" defaultValue={filters.status ?? ""}>
                  <NativeSelectOption value="">{t("detail.filters.all")}</NativeSelectOption>
                  {ORDER_STATUS_FILTERS.map((status) => (
                    <NativeSelectOption key={status} value={status}>
                      {tStatus(status)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <Button type="submit">
                <SearchIcon />
                {t("detail.filters.apply")}
              </Button>
              {filtered ? (
                <Link
                  href={`/customers/${customer.id}`}
                  className={cn(buttonVariants({ variant: "ghost" }))}
                >
                  {t("detail.filters.reset")}
                </Link>
              ) : null}
            </form>
            {orders.length === 0 ? (
              <EmptyState
                icon={<ClipboardListIcon />}
                title={filtered ? t("detail.filters.noResults") : t("detail.noOrders")}
                className="border-0"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("detail.orderColumns.number")}</TableHead>
                    <TableHead>{t("detail.orderColumns.product")}</TableHead>
                    <TableHead>{t("detail.orderColumns.quantity")}</TableHead>
                    <TableHead>{t("detail.orderColumns.due")}</TableHead>
                    <TableHead>{t("detail.orderColumns.status")}</TableHead>
                    <TableHead>{t("detail.orderColumns.progress")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link
                          href={`/orders/${order.id}`}
                          className="font-mono font-medium underline-offset-4 hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">
                        {order.product?.partNumber ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDecimal(order.quantity)} {tUnits(order.unit)}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2 tabular-nums">
                          {formatDay(order.dueDate)}
                          <PriorityBadge priority={order.effectivePriority} />
                          {order.dueWarning ? <DueWarningBadge warning={order.dueWarning} /> : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge
                          status={order.status}
                          closeRequested={order.closeRequestPending}
                        />
                      </TableCell>
                      <TableCell data-testid={`customer-order-progress-${order.orderNumber}`}>
                        <OrderProgress order={order} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {products ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.products", { count: products.total })}</CardTitle>
          </CardHeader>
          <CardContent>
            {products.rows.length === 0 ? (
              <EmptyState
                icon={<PackageIcon />}
                title={t("detail.noProducts")}
                className="border-0"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("detail.columns.partNumber")}</TableHead>
                    <TableHead>{t("detail.columns.name")}</TableHead>
                    <TableHead>{t("detail.columns.drawing")}</TableHead>
                    <TableHead>{t("detail.columns.material")}</TableHead>
                    <TableHead className="text-right">{t("detail.columns.operations")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.rows.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <Link
                          href={`/products/${product.id}`}
                          className="font-mono font-medium underline-offset-4 hover:underline"
                        >
                          {product.partNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.drawingNumber ?? "—"}</TableCell>
                      <TableCell>{product.material?.designation ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {product.operationCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {products.total > products.rows.length ? (
              <p className="pt-2 text-sm text-muted-foreground">
                <Link
                  href={`/products?customer=${customer.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {t("detail.allProducts", { count: products.total })}
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
