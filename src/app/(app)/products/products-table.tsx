"use client";

import {
  ArchiveIcon,
  EllipsisIcon,
  EyeIcon,
  PackageIcon,
  RotateCcwIcon,
  SearchXIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setProductArchivedAction } from "@/modules/products/actions";
import type { ProductRow } from "@/modules/products/queries";
import type { CatalogOption } from "@/modules/catalogs/queries";
import type { CustomerOption } from "@/modules/customers/queries";

export type ProductTableParams = {
  page: number;
  pageSize: number;
  q: string;
  type: string;
  customer: string;
  view: string;
};

const muted = <span className="text-muted-foreground">—</span>;

export function ProductsTable({
  rows,
  total,
  params,
  types,
  customers,
  canManage,
}: {
  rows: ProductRow[];
  total: number;
  params: ProductTableParams;
  types: CatalogOption[];
  customers: CustomerOption[];
  canManage: boolean;
}) {
  const t = useTranslations("products");
  const [archiving, setArchiving] = useState<ProductRow | null>(null);
  const [, startTransition] = useTransition();
  const archivedView = params.view === "archived";
  const filtered = params.q !== "" || params.type !== "" || params.customer !== "";

  const columns = useMemo<DataTableColumn<ProductRow>[]>(() => {
    const restore = (product: ProductRow) =>
      startTransition(async () => {
        const result = await setProductArchivedAction(product.id, false);
        if (result.ok) toast.success(t("restoredToast", { code: product.partNumber }));
        else toast.error(t(`errors.${result.error}`));
      });

    const base: DataTableColumn<ProductRow>[] = [
      {
        accessorKey: "partNumber",
        header: t("columns.partNumber"),
        cell: ({ row }) => (
          <Link
            href={`/products/${row.original.id}`}
            className="font-mono text-sm font-medium underline-offset-4 hover:underline"
          >
            {row.original.partNumber}
          </Link>
        ),
      },
      { accessorKey: "name", header: t("columns.name") },
      {
        id: "customer",
        header: t("columns.customer"),
        cell: ({ row }) =>
          row.original.customer ? (
            <Link
              href={`/customers/${row.original.customer.id}`}
              className="underline-offset-4 hover:underline"
            >
              {row.original.customer.name}
            </Link>
          ) : (
            muted
          ),
      },
      {
        id: "drawing",
        header: t("columns.drawing"),
        cell: ({ row }) => row.original.drawingNumber ?? muted,
      },
      {
        id: "material",
        header: t("columns.material"),
        cell: ({ row }) => {
          return row.original.material ? (
            <span title={row.original.material.groupName}>{row.original.material.designation}</span>
          ) : (
            muted
          );
        },
      },
      {
        id: "type",
        header: t("columns.type"),
        cell: ({ row }) => row.original.type?.name ?? muted,
      },
      {
        id: "operations",
        header: t("columns.operations"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.operationCount}</span>,
      },
    ];

    return [
      ...base,
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => {
          const product = row.original;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("rowActions.menu", { code: product.partNumber })}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuItem render={<Link href={`/products/${product.id}`} />}>
                    <EyeIcon />
                    {t("rowActions.open")}
                  </DropdownMenuItem>
                  {canManage ? (
                    <>
                      <DropdownMenuSeparator />
                      {product.archived ? (
                        <DropdownMenuItem onClick={() => restore(product)}>
                          <RotateCcwIcon />
                          {t("rowActions.restore")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setArchiving(product)}
                        >
                          <ArchiveIcon />
                          {t("rowActions.archive")}
                        </DropdownMenuItem>
                      )}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ];
  }, [t, canManage]);

  return (
    <>
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
            id: "type",
            label: t("columns.type"),
            value: params.type,
            allLabel: t("filters.allTypes"),
            options: types.map((item) => ({ value: item.id, label: item.name })),
          },
          {
            id: "customer",
            label: t("filters.customer"),
            value: params.customer,
            allLabel: t("filters.allCustomers"),
            options: customers.map((item) => ({ value: item.id, label: item.name })),
          },
          {
            id: "view",
            label: t("filters.view"),
            value: params.view,
            allLabel: t("filters.current"),
            options: [{ value: "archived", label: t("filters.archived") }],
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
          ) : archivedView ? (
            <EmptyState
              icon={<ArchiveIcon />}
              title={t("archivedEmptyTitle")}
              description={t("archivedEmptyDescription")}
              className="border-0"
            />
          ) : (
            <EmptyState
              icon={<PackageIcon />}
              title={t("emptyTitle")}
              description={canManage ? t("emptyDescription") : t("emptyReadOnlyDescription")}
              className="border-0"
            />
          )
        }
      />
      {canManage ? (
        <ConfirmDialog
          open={archiving !== null}
          onOpenChange={(open) => !open && setArchiving(null)}
          title={t("archiveTitle", { code: archiving?.partNumber ?? "" })}
          description={t("archiveDescription")}
          confirmLabel={t("rowActions.archive")}
          destructive
          onConfirm={async () => {
            if (!archiving) return;
            const result = await setProductArchivedAction(archiving.id, true);
            if (result.ok) toast.success(t("archivedToast", { code: archiving.partNumber }));
            else toast.error(t(`errors.${result.error}`));
          }}
        />
      ) : null}
    </>
  );
}
