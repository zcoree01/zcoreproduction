import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { Duration } from "@/components/shared/duration";
import { DueWarningBadge, PriorityBadge } from "@/components/shared/order-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDecimal } from "@/lib/decimal";
import type { OrderDetail } from "@/modules/production-orders/queries";
import { barPlan, type PriorityMode } from "@/modules/production-orders/rules";
import { isWholeUnit } from "@/modules/production-orders/schemas";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export function OverviewPanel({
  order,
  priorityMode,
  canReadProducts,
  canReadCustomers,
}: {
  order: OrderDetail;
  priorityMode: PriorityMode;
  canReadProducts: boolean;
  canReadCustomers: boolean;
}) {
  const t = useTranslations("orders.overview");
  const tUnits = useTranslations("productUnits");
  const format = useFormatter();
  const day = (value: string | null) =>
    value
      ? format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })
      : null;
  const plan = barPlan({
    barLength: order.barLength,
    remnant: order.barRemnant,
    pieceLength: order.pieceLength,
    kerf: order.kerf,
    quantity: order.quantity,
    wholePieces: isWholeUnit(order.unit),
  });
  const automatic = priorityMode === "automatic" && order.priority === null;
  const mm = (value: string | null) => (value ? `${formatDecimal(value)} mm` : null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("orderTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Item label={t("customer")}>
              {order.customer ? (
                canReadCustomers ? (
                  <Link
                    href={`/customers/${order.customer.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {order.customer.name}
                  </Link>
                ) : (
                  order.customer.name
                )
              ) : null}
            </Item>
            <Item label={t("product")}>
              {order.product ? (
                <span className="flex flex-col">
                  {canReadProducts ? (
                    <Link
                      href={`/products/${order.product.id}`}
                      className="font-mono underline-offset-4 hover:underline"
                    >
                      {order.product.partNumber}
                    </Link>
                  ) : (
                    <span className="font-mono">{order.product.partNumber}</span>
                  )}
                  <span className="text-muted-foreground">{order.product.name}</span>
                </span>
              ) : null}
            </Item>
            <Item label={t("drawing")}>
              {[order.drawingNumber, t("revision", { revision: order.revision ?? t("unlabeled") })]
                .filter(Boolean)
                .join(" · ")}
            </Item>
            <Item label={t("quantity")}>
              <span className="tabular-nums">
                {formatDecimal(order.quantity)} {tUnits(order.unit)}
              </span>
            </Item>
            <Item label={t("material")}>{order.material}</Item>
            <Item label={t("dueDate")}>
              <span className="flex flex-col items-start gap-1">
                <span className="tabular-nums">
                  {day(order.dueDate)}{" "}
                  <span className="text-muted-foreground">
                    ({t("daysToDue", { days: order.daysToDue })})
                  </span>
                </span>
                {order.dueWarning ? <DueWarningBadge warning={order.dueWarning} /> : null}
              </span>
            </Item>
            <Item label={t("priority")}>
              <span className="flex flex-col items-start gap-1">
                <PriorityBadge priority={order.effectivePriority} automatic={automatic} />
                {priorityMode === "automatic" ? (
                  <span className="text-xs text-muted-foreground">
                    {automatic
                      ? t("priorityAutomatic", { slack: order.slackDays })
                      : t("priorityManual", { computed: order.computedPriority })}
                  </span>
                ) : null}
              </span>
            </Item>
            <Item label={t("planned")}>
              {order.plannedStart || order.plannedEnd
                ? `${day(order.plannedStart) ?? "…"} – ${day(order.plannedEnd) ?? "…"}`
                : null}
            </Item>
            <Item label={t("plannedTime")}>
              <span className="flex flex-col">
                <Duration seconds={order.plannedSeconds} />
                <span className="text-xs text-muted-foreground">
                  {t("remaining")} <Duration seconds={order.remainingSeconds} />
                </span>
              </span>
            </Item>
            {order.sourceOrder ? (
              <Item label={t("copiedFrom")}>
                <Link
                  href={`/orders/${order.sourceOrder.id}`}
                  className="font-mono underline-offset-4 hover:underline"
                >
                  {order.sourceOrder.orderNumber}
                </Link>
              </Item>
            ) : null}
            {order.cancelReason ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <Item label={t("cancelReason")}>
                  <span className="whitespace-pre-line">{order.cancelReason}</span>
                </Item>
              </div>
            ) : null}
            <div className="sm:col-span-2 lg:col-span-3">
              <Item label={t("notes")}>
                {order.notes ? <span className="whitespace-pre-line">{order.notes}</span> : null}
              </Item>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("barTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4">
            <Item label={t("pieceLength")}>{mm(order.pieceLength)}</Item>
            <Item label={t("kerf")}>{mm(order.kerf)}</Item>
            <Item label={t("barLength")}>{mm(order.barLength)}</Item>
            <Item label={t("barRemnant")}>{mm(order.barRemnant)}</Item>
            <Item label={t("piecesPerBar")}>
              {plan ? (
                <span className="font-medium tabular-nums" data-testid="pieces-per-bar">
                  {t("piecesPerBarValue", { pieces: plan.piecesPerBar })}
                  {plan.barsNeeded !== null ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t("barsNeeded", { bars: plan.barsNeeded })}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("noBar")}</span>
              )}
            </Item>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
