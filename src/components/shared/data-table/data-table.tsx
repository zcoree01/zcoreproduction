"use client";

import {
  rowPaginationFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type Updater,
} from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@/lib/data-table/params";
import { cn } from "@/lib/utils";
import { useTableUrl } from "./use-table-url";

// Pagination state only: rows arrive already filtered and paged from the server.
export const dataTableFeatures = tableFeatures({ rowPaginationFeature });

export type DataTableColumn<TData extends RowData> = ColumnDef<typeof dataTableFeatures, TData>;

export type DataTableFilter = {
  /** URL search param name. */
  id: string;
  label: string;
  /** Current value from the server ("" = all). */
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
};

/**
 * TanStack Table with server-side pagination, search and filters. The server
 * page parses the URL (see lib/data-table/params), fetches one page and passes
 * `data` + `rowCount`; this component only renders and updates the URL.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  rowCount,
  page,
  pageSize,
  search,
  filters = [],
  empty,
  getRowId,
}: {
  columns: DataTableColumn<TData>[];
  data: TData[];
  rowCount: number;
  page: number;
  pageSize: number;
  search?: { value: string; placeholder: string };
  filters?: DataTableFilter[];
  /** Rendered when there are no rows at all for the current filters. */
  empty: ReactNode;
  getRowId: (row: TData) => string;
}) {
  const t = useTranslations("dataTable");
  const { update, pending } = useTableUrl();
  const pagination: PaginationState = { pageIndex: page - 1, pageSize };
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    getRowId,
    rowCount,
    state: { pagination },
    manualPagination: true,
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      const sizeChanged = next.pageSize !== pageSize;
      update(
        {
          page: !sizeChanged && next.pageIndex > 0 ? next.pageIndex + 1 : null,
          pageSize: next.pageSize === DEFAULT_PAGE_SIZE ? null : next.pageSize,
        },
        { resetPage: false },
      );
    },
  });

  const first = rowCount === 0 ? 0 : pagination.pageIndex * pageSize + 1;
  const last = Math.min(rowCount, first + data.length - 1);

  return (
    <div className="flex flex-col gap-4">
      {search || filters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {search ? (
            <SearchInput
              value={search.value}
              placeholder={search.placeholder}
              onSearch={(q) => update({ q })}
            />
          ) : null}
          {filters.map((filter) => (
            <NativeSelect
              key={filter.id}
              aria-label={filter.label}
              value={filter.value}
              onChange={(event) => update({ [filter.id]: event.target.value })}
            >
              <NativeSelectOption value="">{filter.allLabel}</NativeSelectOption>
              {filter.options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "overflow-hidden rounded-lg border transition-opacity",
          pending && "opacity-60",
        )}
        aria-busy={pending}
      >
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id} className="h-10 px-4">
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className="h-12 px-4">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-4">
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
        <span aria-live="polite">{t("range", { first, last, total: rowCount })}</span>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            {t("pageSize")}
            <NativeSelect
              size="sm"
              value={String(pageSize)}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
            >
              {PAGE_SIZES.map((size) => (
                <NativeSelectOption key={size} value={size}>
                  {size}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <span>{t("page", { page, pageCount })}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("previous")}
              disabled={page <= 1 || pending}
              onClick={() => table.previousPage()}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("next")}
              disabled={page >= pageCount || pending}
              onClick={() => table.nextPage()}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Debounced so the URL (and the server query) changes once the user pauses.
function SearchInput({
  value,
  placeholder,
  onSearch,
}: {
  value: string;
  placeholder: string;
  onSearch: (query: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => onSearchRef.current(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div className="relative w-full sm:w-72">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  );
}
