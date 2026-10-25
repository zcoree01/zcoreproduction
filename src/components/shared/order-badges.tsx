import { useTranslations } from "next-intl";
import type { DueWarning } from "@/modules/production-orders/rules";
import type { OperationStatus, OrderStatus } from "@/modules/production-orders/status-rules";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "./status-badge";

export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  draft: "neutral",
  planned: "info",
  waiting_material: "warning",
  cutting: "info",
  ready: "info",
  in_progress: "success",
  paused: "warning",
  quality_check: "info",
  completed: "success",
  cancelled: "danger",
  archived: "neutral",
};

/**
 * Order status; while a request to close with a shortage waits for approval
 * the badge says so instead of the status (in production / quality control).
 */
export function OrderStatusBadge({
  status,
  closeRequested = false,
  className,
}: {
  status: OrderStatus;
  closeRequested?: boolean;
  className?: string;
}) {
  const t = useTranslations("orderStatus");
  if (closeRequested) {
    return (
      <StatusBadge tone="warning" className={className}>
        {t("close_requested")}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone={ORDER_STATUS_TONE[status]} className={className}>
      {t(status)}
    </StatusBadge>
  );
}

const OPERATION_STATUS_TONE: Record<OperationStatus, StatusTone> = {
  waiting: "neutral",
  ready: "info",
  in_progress: "success",
  paused: "warning",
  done: "success",
};

/** Operation status; external operations use the shipping steps as labels. */
export function OperationStatusBadge({
  status,
  external = false,
  className,
}: {
  status: OperationStatus;
  external?: boolean;
  className?: string;
}) {
  const t = useTranslations("operationStatus");
  const tExternal = useTranslations("externalOperationStatus");
  return (
    <StatusBadge tone={OPERATION_STATUS_TONE[status]} className={className}>
      {external ? tExternal(status) : t(status)}
    </StatusBadge>
  );
}

const PRIORITY_CLASS: Record<number, string> = {
  1: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  2: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  3: "border-sky-500/30 text-sky-700 dark:text-sky-300",
  4: "text-muted-foreground",
  5: "text-muted-foreground",
};

/** 1 = extremely urgent … 5 = not urgent; the label is always shown with the number. */
export function PriorityBadge({
  priority,
  automatic = false,
  className,
}: {
  priority: number;
  automatic?: boolean;
  className?: string;
}) {
  const t = useTranslations("priority");
  const level = Math.min(5, Math.max(1, priority));
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-4xl border px-2 text-xs font-medium whitespace-nowrap",
        PRIORITY_CLASS[level],
        className,
      )}
      title={automatic ? t("automaticHint") : undefined}
    >
      <span className="tabular-nums">{level}</span>
      <span className="font-normal">{t(`levels.${level}` as "levels.1")}</span>
      {automatic ? <span aria-hidden>·A</span> : null}
    </span>
  );
}

export function DueWarningBadge({
  warning,
  className,
}: {
  warning: DueWarning;
  className?: string;
}) {
  const t = useTranslations("dueWarning");
  const tone: StatusTone = warning.kind === "due_soon" ? "warning" : "danger";
  return (
    <StatusBadge tone={tone} className={className}>
      {warning.kind === "due_soon" ? t("due_soon", { days: warning.days }) : t(warning.kind)}
    </StatusBadge>
  );
}
