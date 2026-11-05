import { PackageCheckIcon, TruckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { listFinishedStock, type FinishedStockRow } from "@/modules/finished-goods/queries";

export default function FinishedGoodsPage() {
  return (
    <PageSuspense>
      <FinishedGoodsContent />
    </PageSuspense>
  );
}

async function FinishedGoodsContent() {
  const member = await requireMember();
  const [t, tUnits, access] = await Promise.all([
    getTranslations("finishedGoods"),
    getTranslations("productUnits"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("finished_goods")) return <ModuleDisabled />;
  if (!access.permissions.has("finished_goods.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const rows = await listFinishedStock(member.organization.id);
  const byCustomer = new Map<string, FinishedStockRow[]>();
  for (const row of rows)
    byCustomer.set(row.customerId, [...(byCustomer.get(row.customerId) ?? []), row]);
  const canManage = access.permissions.has("finished_goods.manage");
  const amount = (row: FinishedStockRow, value: string) =>
    `${formatDecimal(value)} ${tUnits(row.unit as "pcs")}`;

  return (
    <>
      <PageHeader title={t("stock.title")} description={t("stock.description")} />
      {rows.length === 0 ? (
        <EmptyState
          icon={<PackageCheckIcon />}
          title={t("stock.emptyTitle")}
          description={t("stock.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {[...byCustomer.entries()].map(([customerId, orders]) => (
            <Card key={customerId}>
              <CardHeader>
                <CardTitle>{orders[0]?.customer}</CardTitle>
                {canManage ? (
                  <CardAction>
                    <Link
                      href={`/inventory/delivery-notes/new?customer=${customerId}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <TruckIcon />
                      {t("stock.deliver", { customer: orders[0]?.customer ?? "" })}
                    </Link>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("stock.columns.order")}</TableHead>
                      <TableHead>{t("stock.columns.product")}</TableHead>
                      <TableHead>{t("stock.columns.position")}</TableHead>
                      <TableHead className="text-right">{t("stock.columns.received")}</TableHead>
                      <TableHead className="text-right">{t("stock.columns.shipped")}</TableHead>
                      <TableHead className="text-right">{t("stock.columns.onHand")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((row) => (
                      <TableRow key={row.orderId}>
                        <TableCell className="font-mono">
                          <Link href={`/orders/${row.orderId}`} className="hover:underline">
                            {row.orderNumber}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {row.partNumber} · {row.productName}
                        </TableCell>
                        <TableCell>{row.customerPosition ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {amount(row, row.received)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {amount(row, row.shipped)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {amount(row, row.onHand)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
