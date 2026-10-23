"use client";

import { SearchXIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";

export type UserTableRow = {
  userId: string;
  username: string;
  fullName: string | null;
  roleLabel: string;
  active: boolean;
};

export function UsersTable({
  rows,
  total,
  page,
  pageSize,
  query,
  role,
  status,
  roleOptions,
}: {
  rows: UserTableRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  role: string;
  status: string;
  roleOptions: { value: string; label: string }[];
}) {
  const t = useTranslations("users");
  const filtered = query !== "" || role !== "" || status !== "";

  const columns = useMemo<DataTableColumn<UserTableRow>[]>(
    () => [
      {
        accessorKey: "username",
        header: t("columns.username"),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.username}</span>,
      },
      {
        accessorKey: "fullName",
        header: t("columns.fullName"),
        cell: ({ row }) =>
          row.original.fullName ?? <span className="text-muted-foreground">—</span>,
      },
      { accessorKey: "roleLabel", header: t("columns.role") },
      {
        accessorKey: "active",
        header: t("columns.status"),
        cell: ({ row }) =>
          row.original.active ? (
            <StatusBadge tone="success">{t("status.active")}</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">{t("status.inactive")}</StatusBadge>
          ),
      },
    ],
    [t],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowCount={total}
      page={page}
      pageSize={pageSize}
      getRowId={(row) => row.userId}
      search={{ value: query, placeholder: t("searchPlaceholder") }}
      filters={[
        {
          id: "role",
          label: t("columns.role"),
          value: role,
          allLabel: t("filters.allRoles"),
          options: roleOptions,
        },
        {
          id: "status",
          label: t("columns.status"),
          value: status,
          allLabel: t("filters.allStatuses"),
          options: [
            { value: "active", label: t("status.active") },
            { value: "inactive", label: t("status.inactive") },
          ],
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
            icon={<UsersIcon />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            className="border-0"
          />
        )
      }
    />
  );
}
