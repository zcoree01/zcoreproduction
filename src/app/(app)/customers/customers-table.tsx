"use client";

import { ArchiveIcon, BuildingIcon, RotateCcwIcon, SearchXIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useTransition } from "react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { setCustomerArchivedAction } from "@/modules/customers/actions";
import type { CustomerRow } from "@/modules/customers/queries";

export type CustomerTableParams = { page: number; pageSize: number; q: string; view: string };

const muted = <span className="text-muted-foreground">—</span>;

export function CustomersTable({
  rows,
  total,
  params,
  canManage,
}: {
  rows: CustomerRow[];
  total: number;
  params: CustomerTableParams;
  canManage: boolean;
}) {
  const t = useTranslations("customers");
  const [pending, startTransition] = useTransition();
  const archivedView = params.view === "archived";

  const columns = useMemo<DataTableColumn<CustomerRow>[]>(() => {
    const restore = (customer: CustomerRow) =>
      startTransition(async () => {
        const result = await setCustomerArchivedAction(customer.id, false);
        if (result.ok) toast.success(t("restoredToast", { name: customer.name }));
        else toast.error(t(`form.errors.${result.error}`));
      });

    const base: DataTableColumn<CustomerRow>[] = [
      {
        accessorKey: "number",
        header: t("columns.number"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.number}</span>,
      },
      {
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <Link
            href={`/customers/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "city",
        header: t("columns.city"),
        cell: ({ row }) =>
          [row.original.city, row.original.country].filter(Boolean).join(", ") || muted,
      },
      {
        id: "contact",
        header: t("columns.contact"),
        cell: ({ row }) =>
          [row.original.contactPerson, row.original.phone, row.original.email]
            .filter(Boolean)
            .join(" · ") || muted,
      },
      {
        id: "products",
        header: t("columns.products"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span>,
      },
    ];
    if (!canManage || !archivedView) return base;
    return [
      ...base,
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => restore(row.original)}
            >
              <RotateCcwIcon />
              {t("restore")}
            </Button>
          </div>
        ),
      },
    ];
  }, [t, canManage, archivedView, pending]);

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
          id: "view",
          label: t("filters.view"),
          value: params.view,
          allLabel: t("filters.current"),
          options: [{ value: "archived", label: t("filters.archived") }],
        },
      ]}
      empty={
        params.q !== "" ? (
          <EmptyState
            icon={<SearchXIcon />}
            title={t("noResultsTitle")}
            description={t("noResultsDescription")}
            className="border-0"
          />
        ) : archivedView ? (
          <EmptyState icon={<ArchiveIcon />} title={t("archivedEmptyTitle")} className="border-0" />
        ) : (
          <EmptyState
            icon={<BuildingIcon />}
            title={t("emptyTitle")}
            description={canManage ? t("emptyDescription") : t("emptyReadOnlyDescription")}
            className="border-0"
          />
        )
      }
    />
  );
}
