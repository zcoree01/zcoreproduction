"use client";

import { SearchXIcon, TruckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import type { DeliveryNoteRow } from "@/modules/finished-goods/queries";

export type DeliveryNoteTableParams = {
  page: number;
  pageSize: number;
  q: string;
  status: string;
};

export function DeliveryNotesTable({
  rows,
  total,
  params,
}: {
  rows: DeliveryNoteRow[];
  total: number;
  params: DeliveryNoteTableParams;
}) {
  const t = useTranslations("finishedGoods");
  const format = useFormatter();

  const columns = useMemo<DataTableColumn<DeliveryNoteRow>[]>(
    () => [
      {
        accessorKey: "number",
        header: t("notes.columns.number"),
        cell: ({ row }) => (
          <Link
            href={`/inventory/delivery-notes/${row.original.id}`}
            className="font-mono font-medium hover:underline"
          >
            {row.original.number}
          </Link>
        ),
      },
      { accessorKey: "customer", header: t("notes.columns.customer") },
      {
        id: "date",
        header: t("notes.columns.date"),
        // A calendar date (no time): formatted at noon UTC so no zone shifts it.
        cell: ({ row }) =>
          format.dateTime(new Date(`${row.original.issuedOn}T12:00:00Z`), {
            dateStyle: "medium",
            timeZone: "UTC",
          }),
      },
      {
        id: "lines",
        header: () => <span className="block text-right">{t("notes.columns.lines")}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{row.original.lines}</span>
        ),
      },
      {
        id: "status",
        header: t("notes.columns.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.status === "issued" ? "outline" : "destructive"}>
            {t(`notes.status.${row.original.status}`)}
          </Badge>
        ),
      },
    ],
    [t, format],
  );

  const filtered = params.q !== "" || params.status !== "";

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowCount={total}
      page={params.page}
      pageSize={params.pageSize}
      getRowId={(row) => row.id}
      search={{ value: params.q, placeholder: t("notes.searchPlaceholder") }}
      filters={[
        {
          id: "status",
          label: t("notes.columns.status"),
          value: params.status,
          allLabel: t("notes.allStatuses"),
          options: [
            { value: "issued", label: t("notes.status.issued") },
            { value: "cancelled", label: t("notes.status.cancelled") },
          ],
        },
      ]}
      empty={
        filtered ? (
          <EmptyState
            icon={<SearchXIcon />}
            title={t("notes.noResultsTitle")}
            description={t("notes.noResultsDescription")}
            className="border-0"
          />
        ) : (
          <EmptyState
            icon={<TruckIcon />}
            title={t("notes.emptyTitle")}
            description={t("notes.emptyDescription")}
            className="border-0"
          />
        )
      }
    />
  );
}
