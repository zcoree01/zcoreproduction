import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  DueWarningBadge,
  OperationStatusBadge,
  PriorityBadge,
} from "@/components/shared/order-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDecimal } from "@/lib/decimal";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FloorQueueItem } from "@/modules/production-orders/floor";

/** One operation in a worker's list (large touch target, links to the operation). */
export function FloorOperationCard({ item }: { item: FloorQueueItem }) {
  const t = useTranslations("floorOrders");
  const tUnits = useTranslations("productUnits");
  return (
    <Link
      href={`/floor/operations/${item.operationId}`}
      className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Card
        className={cn(
          "transition-colors hover:bg-muted/40",
          item.arrived && "ring-2 ring-emerald-500/60",
        )}
      >
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <PriorityBadge priority={item.priority} />
            <span className="font-mono">{item.orderNumber}</span>
          </CardTitle>
          <p className="text-sm">
            <span className="font-mono font-medium">{item.partNumber}</span> · {item.productName}
            {item.revision ? (
              <span className="text-muted-foreground">
                {" "}
                · {t("revision", { revision: item.revision })}
              </span>
            ) : null}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {item.operationCode}
            </Badge>
            <span className="font-medium">{item.operationName}</span>
            {item.machineCode ? (
              <span className="text-muted-foreground">{item.machineCode}</span>
            ) : null}
            <OperationStatusBadge status={item.status} />
            {item.assignedByName ? <Badge variant="secondary">{t("assignedBadge")}</Badge> : null}
          </div>
          <p className="text-lg font-semibold tabular-nums">
            {t("quantity", { quantity: formatDecimal(item.quantity), unit: tUnits(item.unit) })}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>{t("due", { date: formatDay(item.dueDate) })}</span>
            {item.dueWarning === "overdue" || item.dueWarning === "behind" ? (
              <DueWarningBadge warning={{ kind: item.dueWarning }} />
            ) : null}
          </div>
          {item.arrived ? (
            <p className="font-medium text-emerald-700 dark:text-emerald-300">
              {item.previous ? t("arrivedFrom", { code: item.previous.code }) : t("arrivedFirst")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {t("coming", { code: item.previous?.code ?? "—" })}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
