import { ArrowLeftIcon, ChevronRightIcon, ClipboardXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import {
  OperationStatusBadge,
  OrderStatusBadge,
  PriorityBadge,
} from "@/components/shared/order-badges";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getFloorOrder } from "@/modules/production-orders/floor";
import { pickMyOperation } from "@/modules/production-orders/floor-rules";

// Target of the order's QR code: goes straight to the caller's operation when
// it is clear which one it is, otherwise shows the order with its operations.

export default function FloorOrderPage({ params }: PageProps<"/floor/orders/[id]">) {
  return (
    <PageSuspense>
      <FloorOrderContent params={params} />
    </PageSuspense>
  );
}

async function FloorOrderContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const [t, tUnits, access] = await Promise.all([
    getTranslations("floorOrders"),
    getTranslations("productUnits"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("production")) return <ModuleDisabled />;

  const { id } = await params;
  const orderId = z.uuid().safeParse(id);
  const result = orderId.success ? await getFloorOrder(orderId.data) : null;

  const back = (
    <Link
      href="/floor/operations"
      className="inline-flex min-h-12 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      {t("back")}
    </Link>
  );
  if (!result) {
    return (
      <>
        {back}
        <EmptyState
          icon={<ClipboardXIcon />}
          title={t("orderNotFoundTitle")}
          description={t("orderNotFoundDescription")}
        />
      </>
    );
  }

  const target = pickMyOperation(result.operations);
  if (target) redirect(`/floor/operations/${target}`);

  const { order, operations } = result;
  const mine = operations.filter((op) => op.mine && op.status !== "done");
  const current = operations.find((op) => op.status !== "done") ?? null;

  return (
    <>
      {back}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={order.effective_priority} />
          <OrderStatusBadge status={order.status} />
        </div>
        <h1 className="font-mono text-2xl font-semibold">{order.order_number}</h1>
        <p>
          <span className="font-mono font-medium">{order.part_number}</span> · {order.product_name}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatDecimal(order.quantity)} {tUnits(order.unit)} ·{" "}
          {t("due", { date: formatDay(order.due_date) })}
        </p>
      </div>

      <p className="rounded-lg bg-muted p-3 text-sm">
        {mine.length === 0
          ? current
            ? t("orderNotYours", {
                code: current.code,
                machine: current.machine_code ?? "—",
              })
            : t("allDone")
          : t("orderPick")}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("routingTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2">
            {operations.map((op) => {
              const content = (
                <>
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{op.code}</span>
                    <span>{op.name}</span>
                    {op.machine_code ? (
                      <span className="text-xs text-muted-foreground">{op.machine_code}</span>
                    ) : null}
                    {op.mine && op.status !== "done" ? (
                      <Badge variant="secondary">
                        {op.arrived ? t("arrivedBadge") : t("comingBadge")}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-1">
                    <OperationStatusBadge status={op.status} />
                    {op.mine ? <ChevronRightIcon className="size-4" aria-hidden /> : null}
                  </span>
                </>
              );
              return (
                <li key={op.id}>
                  {op.mine ? (
                    <Link
                      href={`/floor/operations/${op.id}`}
                      className={cn(
                        "flex min-h-12 items-center justify-between gap-2 rounded-lg border px-3",
                        op.id === current?.id && "border-primary",
                      )}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex min-h-12 items-center justify-between gap-2 px-3 text-muted-foreground">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
