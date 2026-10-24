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
import { Badge } from "@/components/ui/badge";
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
import type { ProductCatalogs } from "./product-sheet";

export type ProductTableParams = {
  page: number;
  pageSize: number;
  q: string;
  type: string;
  shape: string;
  view: string;
};

const muted = <span className="text-muted-foreground">—</span>;

export function ProductsTable({
  rows,
  total,
  params,
  catalogs,
  canManage,
}: {
  rows: ProductRow[];
  total: number;
  params: ProductTableParams;
  catalogs: ProductCatalogs;
  canManage: boolean;
}) {
  const t = useTranslations("products");
  const [archiving, setArchiving] = useState<ProductRow | null>(null);
  const [, startTransition] = useTransition();
  const archivedView = params.view === "archived";
  const filtered = params.q !== "" || params.type !== "" || params.shape !== "";

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
        id: "revision",
        header: t("columns.revision"),
        cell: ({ row }) =>
          row.original.revision ? <Badge variant="outline">{row.original.revision}</Badge> : muted,
      },
      {
        id: "customer",
        header: t("columns.customer"),
        cell: ({ row }) => row.original.customerName ?? muted,
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
          const text = [row.original.materialGrade, row.original.materialShape?.name]
            .filter(Boolean)
            .join(" · ");
          return text || muted;
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
            options: catalogs.types.map((item) => ({ value: item.id, label: item.name })),
          },
          {
            id: "shape",
            label: t("filters.shape"),
            value: params.shape,
            allLabel: t("filters.allShapes"),
            options: catalogs.shapes.map((item) => ({ value: item.id, label: item.name })),
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
