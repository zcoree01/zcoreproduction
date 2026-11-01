import { LayoutGridIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import {
  countPendingAdjustments,
  countSubmittedStockCounts,
  listOrderShortages,
  listStockItems,
} from "@/modules/inventory/queries";
import { displayUnit, toDisplayQuantity, type BaseUnit } from "@/modules/inventory/rules";

const SHOWN = 8;

export default function DashboardPage() {
  return (
    <PageSuspense>
      <DashboardContent />
    </PageSuspense>
  );
}

async function DashboardContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("dashboard"), getMemberAccess(member)]);
  const warehouse = access.modules.has("inventory") && access.permissions.has("inventory.read");

  return (
    <>
      <PageHeader
        title={t("welcome", { name: member.fullName ?? member.username })}
        description={member.organization.name}
      />
      {warehouse ? (
        <InventoryWarnings organizationId={member.organization.id} />
      ) : (
        <EmptyState
          icon={<LayoutGridIcon />}
          title={t("noModulesTitle")}
          description={t("noModulesDescription")}
        />
      )}
    </>
  );
}

/** Below minimum, orders short of material, corrections and counts to approve (D-033). */
async function InventoryWarnings({ organizationId }: { organizationId: string }) {
  const [t, tStock, format, items, shortages, adjustments, counts] = await Promise.all([
    getTranslations("inventory.warnings"),
    getTranslations("inventory"),
    getFormatter(),
    listStockItems(organizationId),
    listOrderShortages(organizationId),
    countPendingAdjustments(organizationId),
    countSubmittedStockCounts(organizationId),
  ]);
  const below = items.filter((item) => item.belowMinimum);
  const quantity = (unit: BaseUnit, value: string) =>
    tStock("quantity", {
      value: formatDecimal(toDisplayQuantity(unit, value)),
      unit: tStock(`displayUnits.${displayUnit(unit)}`),
    });
  const more = (count: number) =>
    count > SHOWN ? (
      <li className="text-sm text-muted-foreground">{t("more", { count: count - SHOWN })}</li>
    ) : null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("belowMinimum")}</CardTitle>
          </CardHeader>
          <CardContent>
            {below.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("belowMinimumNone")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {below.slice(0, SHOWN).map((item) => (
                  <li key={item.id} className="flex justify-between gap-2 text-sm">
                    <Link href={`/inventory/${item.id}`} className="hover:underline">
                      {item.code} · {item.name}
                    </Link>
                    <span className="text-destructive tabular-nums">
                      {quantity(item.baseUnit, item.ownQuantity)}
                    </span>
                  </li>
                ))}
                {more(below.length)}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shortages")}</CardTitle>
          </CardHeader>
          <CardContent>
            {shortages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shortagesNone")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {shortages.slice(0, SHOWN).map((row) => (
                  <li key={row.orderId} className="text-sm">
                    <Link href={`/orders/${row.orderId}?tab=material`} className="hover:underline">
                      {t("shortageRow", {
                        order: row.orderNumber,
                        item: row.itemCode,
                        quantity: quantity(row.baseUnit, row.shortage),
                      })}
                    </Link>
                    <span className="ml-2 text-muted-foreground">
                      {format.dateTime(new Date(`${row.dueDate}T12:00:00Z`), {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      })}
                    </span>
                  </li>
                ))}
                {more(shortages.length)}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("toApprove")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {adjustments === 0 && counts === 0 ? (
              <p className="text-muted-foreground">{t("nothingToApprove")}</p>
            ) : (
              <>
                {adjustments > 0 ? (
                  <Link href="/inventory/adjustments" className="hover:underline">
                    {t("pendingAdjustments", { count: adjustments })}
                  </Link>
                ) : null}
                {counts > 0 ? (
                  <Link href="/inventory/counts" className="hover:underline">
                    {t("submittedCounts", { count: counts })}
                  </Link>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
