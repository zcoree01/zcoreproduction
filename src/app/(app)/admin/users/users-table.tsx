"use client";

import { EllipsisIcon, KeyRoundIcon, SearchXIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  TempCredentialsDialog,
  type TempCredentialsInfo,
} from "@/components/shared/temp-credentials-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resetUserPasswordAction } from "@/modules/users/actions";

export type UserTableRow = {
  userId: string;
  username: string;
  fullName: string | null;
  roleLabel: string;
  active: boolean;
  mustChangePassword: boolean;
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
  canManage,
  currentUserId,
  organizationName,
}: {
  rows: UserTableRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  role: string;
  status: string;
  roleOptions: { value: string; label: string }[];
  canManage: boolean;
  currentUserId: string;
  organizationName: string;
}) {
  const t = useTranslations("users");
  const filtered = query !== "" || role !== "" || status !== "";
  const [resetting, setResetting] = useState<UserTableRow | null>(null);
  const [credentials, setCredentials] = useState<TempCredentialsInfo | null>(null);

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
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.active ? (
              <StatusBadge tone="success">{t("status.active")}</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">{t("status.inactive")}</StatusBadge>
            )}
            {row.original.mustChangePassword ? (
              <StatusBadge tone="warning">{t("status.tempPassword")}</StatusBadge>
            ) : null}
          </div>
        ),
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: () => <span className="sr-only">{t("columns.actions")}</span>,
              cell: ({ row }) =>
                row.original.userId === currentUserId ? null : (
                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("rowActions.menu", { username: row.original.username })}
                          />
                        }
                      >
                        <EllipsisIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onClick={() => setResetting(row.original)}>
                          <KeyRoundIcon />
                          {t("rowActions.resetPassword")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ),
            } satisfies DataTableColumn<UserTableRow>,
          ]
        : []),
    ],
    [t, canManage, currentUserId],
  );

  return (
    <>
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
      {canManage ? (
        <>
          <ConfirmDialog
            open={resetting !== null}
            onOpenChange={(open) => !open && setResetting(null)}
            title={t("resetTitle", { username: resetting?.username ?? "" })}
            description={t("resetDescription")}
            confirmLabel={t("rowActions.resetPassword")}
            destructive
            onConfirm={async () => {
              if (!resetting) return;
              const target = resetting;
              const result = await resetUserPasswordAction(target.userId);
              if (result.ok) {
                setCredentials({
                  username: result.username,
                  password: result.password,
                  fullName: target.fullName ?? target.username,
                  organizationName,
                });
              } else {
                toast.error(t(`resetErrors.${result.error}`));
              }
            }}
          />
          <TempCredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
        </>
      ) : null}
    </>
  );
}
