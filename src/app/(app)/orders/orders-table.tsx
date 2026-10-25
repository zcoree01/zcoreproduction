"use client";

import { ClipboardListIcon, SearchXIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table/data-table";
import { Duration } from "@/components/shared/duration";
import { EmptyState } from "@/components/shared/empty-state";
import { OrderProgress } from "@/components/shared/order-progress";
import { DueWarningBadge, OrderStatusBadge, PriorityBadge } from "@/components/shared/order-badges";
import { formatDecimal } from "@/lib/decimal";
import { formatDay } from "@/lib/format";
import type { CustomerOption } from "@/modules/customers/queries";
import { DUE_FILTERS, ORDER_STATUS_FILTERS } from "@/modules/production-orders/list-params";
import type { MachineChoice, OrderRow } from "@/modules/production-orders/queries";
import type { PriorityMode } from "@/modules/production-orders/rules";

export type OrderTableParams = {
  page: number;
  pageSize: number;
  q: string;
  status: string;
  priority: string;
  customer: string;
  machine: string;
  due: string;
};

export function OrdersTable({
  rows,
  total,
  params,
  customers,
  machines,
  priorityMode,
}: {
  rows: OrderRow[];
  total: number;
  params: OrderTableParams;
  customers: CustomerOption[];
  machines: MachineChoice[];
  priorityMode: PriorityMode;
}) {
  const t = useTranslations("orders");
  const tStatus = useTranslations("orderStatus");
  const tPriority = useTranslations("priority");
  const tUnits = useTranslations("productUnits");
  const filtered =
    params.q !== "" ||
    params.status !== "" ||
    params.priority !== "" ||
    params.customer !== "" ||
    params.machine !== "" ||
    params.due !== "";

  const columns = useMemo<DataTableColumn<OrderRow>[]>(
    () => [
      {
        accessorKey: "orderNumber",
        header: t("columns.number"),
        cell: ({ row }) => (
          <Link
            href={`/orders/${row.original.id}`}
            className="font-mono text-sm font-medium whitespace-nowrap underline-offset-4 hover:underline"
          >
            {row.original.orderNumber}
          </Link>
        ),
      },
      {
        id: "priority",
        header: t("columns.priority"),
        cell: ({ row }) => (
          <PriorityBadge
            priority={row.original.effectivePriority}
            automatic={priorityMode === "automatic" && row.original.priority === null}
          />
        ),
      },
      {
        id: "product",
        header: t("columns.product"),
        cell: ({ row }) =>
          row.original.product ? (
            <div className="flex flex-col">
              <span className="font-mono text-sm">{row.original.product.partNumber}</span>
              <span className="text-xs text-muted-foreground">{row.original.product.name}</span>
            </div>
          ) : (
            "—"
          ),
      },
      {
        id: "customer",
        header: t("columns.customer"),
        cell: ({ row }) => row.original.customer?.name ?? "—",
      },
      {
        id: "quantity",
        header: t("columns.quantity"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDecimal(row.original.quantity)} {tUnits(row.original.unit)}
          </span>
        ),
      },
      {
        id: "due",
        header: t("columns.due"),
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <span className="whitespace-nowrap tabular-nums">
              {formatDay(row.original.dueDate)}
            </span>
            {row.original.dueWarning ? <DueWarningBadge warning={row.original.dueWarning} /> : null}
          </div>
        ),
      },
      {
        id: "time",
        header: t("columns.plannedTime"),
        cell: ({ row }) => <Duration seconds={row.original.plannedSeconds} />,
      },
      {
        id: "progress",
        header: t("columns.progress"),
        cell: ({ row }) => <OrderProgress order={row.original} compact />,
      },
      {
        id: "status",
        header: t("columns.status"),
        cell: ({ row }) => (
          <OrderStatusBadge
            status={row.original.status}
            closeRequested={row.original.closeRequestPending}
          />
        ),
      },
    ],
    [t, tUnits, priorityMode],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowCount={total}
      page={params.page}
      pageSize={params.pageSize}
      getRowId={(row) => row.id}
      search={{ value: params.q, placeholder: t("searchPlaceholder") }}
      filters={[
        {
          id: "status",
          label: t("columns.status"),
          value: params.status,
          allLabel: t("filters.allStatuses"),
          options: ORDER_STATUS_FILTERS.map((status) => ({
            value: status,
            label: tStatus(status),
          })),
        },
        {
          id: "priority",
          label: t("columns.priority"),
          value: params.priority,
          allLabel: t("filters.allPriorities"),
          options: (["1", "2", "3", "4", "5"] as const).map((level) => ({
            value: level,
            label: `${level} – ${tPriority(`levels.${level}`)}`,
          })),
        },
        {
          id: "due",
          label: t("filters.due"),
          value: params.due,
          allLabel: t("filters.allDue"),
          options: DUE_FILTERS.map((due) => ({
            value: due,
            label: t(`filters.dueOptions.${due}`),
          })),
        },
        {
          id: "customer",
          label: t("columns.customer"),
          value: params.customer,
          allLabel: t("filters.allCustomers"),
          options: customers.map((item) => ({ value: item.id, label: item.name })),
        },
        {
          id: "machine",
          label: t("filters.machine"),
          value: params.machine,
          allLabel: t("filters.allMachines"),
          options: machines.map((item) => ({
            value: item.id,
            label: `${item.code} · ${item.name}`,
          })),
        },
      ]}
      empty={
        filtered ? (
          <EmptyState
            icon={<SearchXIcon />}
            title={t("noResultsTitle")}
            description={t("noResultsDescription")}
            className="border-0"
          />
        ) : (
          <EmptyState
            icon={<ClipboardListIcon />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            className="border-0"
          />
        )
      }
    />
  );
}
