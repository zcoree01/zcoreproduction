import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { OrderRow } from "@/modules/production-orders/queries";

const twoDigits = (value: number) => String(value).padStart(2, "0");

/**
 * Progress bar; below it the code of the operation the order has reached and
 * its position in the routing ("KT 02/08"). The full variant adds the
 * operation's name and machine.
 */
export function OrderProgress({
  order,
  compact = false,
  className,
}: {
  order: Pick<
    OrderRow,
    "progressPercent" | "currentOperation" | "status" | "operationsDone" | "operationCount"
  >;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("orderProgress");
  const percent = Math.min(100, Math.max(0, order.progressPercent));
  const current = order.currentOperation;
  const total = order.operationCount;
  // Operations are finished in order: the current one follows the done ones.
  const position = current ? Math.min(order.operationsDone + 1, total) : total;
  const detail = current
    ? current.machineCode
      ? t("nameMachine", { name: current.name, machine: current.machineCode })
      : current.name
    : order.status === "draft"
      ? t("notStarted")
      : t("done");
  return (
    <div className={cn("flex flex-col gap-1", compact ? "w-28" : "w-44", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("label", { percent })}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            percent === 100 ? "bg-emerald-600" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate" title={detail}>
          {current ? <span className="font-mono font-semibold">{current.code}</span> : null}
          {!compact || !current ? (
            <span className="text-muted-foreground">
              {current ? " · " : null}
              {detail}
            </span>
          ) : null}
        </span>
        {total > 0 ? (
          <span className="shrink-0 font-medium text-muted-foreground tabular-nums">
            {twoDigits(position)}/{twoDigits(total)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
