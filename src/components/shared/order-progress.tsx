import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { OrderRow } from "@/modules/production-orders/queries";

/**
 * Progress bar with percent and the operation the order has reached
 * (compact: operation code and machine only, for dense tables).
 */
export function OrderProgress({
  order,
  compact = false,
  className,
}: {
  order: Pick<OrderRow, "progressPercent" | "currentOperation" | "status">;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("orderProgress");
  const percent = Math.min(100, Math.max(0, order.progressPercent));
  const current = order.currentOperation;
  return (
    <div className={cn("flex flex-col gap-1", compact ? "w-28" : "w-36", className)}>
      <div className="flex items-center gap-2">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t("label", { percent })}
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              percent === 100 ? "bg-emerald-600" : "bg-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="w-10 text-right text-xs font-medium tabular-nums">{percent} %</span>
      </div>
      <span className="truncate text-xs text-muted-foreground">
        {current && compact
          ? [current.code, current.machineCode].filter(Boolean).join(" · ")
          : current
            ? current.machineCode
              ? t("atMachine", {
                  code: current.code,
                  name: current.name,
                  machine: current.machineCode,
                })
              : t("at", { code: current.code, name: current.name })
            : order.status === "draft"
              ? t("notStarted")
              : t("done")}
      </span>
    </div>
  );
}
