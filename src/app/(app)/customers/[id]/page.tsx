import { ArrowLeftIcon, BuildingIcon, ClipboardListIcon, PackageIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { DueWarningBadge, OrderStatusBadge } from "@/components/shared/order-badges";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { formatDecimal } from "@/lib/decimal";
import { getCustomer } from "@/modules/customers/queries";
import { listCustomerOrders } from "@/modules/production-orders/queries";
import { listProductsPage } from "@/modules/products/queries";
import { CustomerActions } from "./customer-actions";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <PageSuspense>
      <CustomerContent params={params} />
    </PageSuspense>
  );
}

async function CustomerContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tUnits, access] = await Promise.all([
    getTranslations("customers"),
    getTranslations("productUnits"),
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
  const orders = access.permissions.has("orders.read")
    ? await listCustomerOrders(organizationId, customer.id)
    : null;

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
              {[customer.city, customer.country].filter(Boolean).join(", ") || null}
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

      {orders ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.orders", { count: orders.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <EmptyState
                icon={<ClipboardListIcon />}
                title={t("detail.noOrders")}
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
                          {order.dueDate}
                          {order.dueWarning ? <DueWarningBadge warning={order.dueWarning} /> : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={order.status} />
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
