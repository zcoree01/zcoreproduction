"use client";

import {
  ArchiveIcon,
  EllipsisIcon,
  HardHatIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchXIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setEmployeeArchivedAction } from "@/modules/employees/actions";
import type { EmployeeRow } from "@/modules/employees/queries";
import { EMPLOYEE_STATUSES } from "@/modules/employees/schemas";
import { EmployeeSheet, type EmployeeFormOptions } from "./employee-sheet";

export type EmployeeTableParams = {
  page: number;
  pageSize: number;
  q: string;
  department: string;
  skill: string;
  status: string;
  view: string;
};

const MAX_CHIPS = 3;
const muted = <span className="text-muted-foreground">—</span>;
const fullName = (employee: EmployeeRow) => `${employee.firstName} ${employee.lastName}`;

function Chips({ items, more }: { items: string[]; more: (count: number) => string }) {
  if (items.length === 0) return muted;
  const shown = items.slice(0, MAX_CHIPS);
  return (
    <div className="flex max-w-64 flex-wrap gap-1">
      {shown.map((item) => (
        <Badge key={item} variant="secondary" className="font-normal">
          {item}
        </Badge>
      ))}
      {items.length > MAX_CHIPS ? (
        <Badge variant="outline" className="font-normal" title={items.join(", ")}>
          {more(items.length - MAX_CHIPS)}
        </Badge>
      ) : null}
    </div>
  );
}

export function EmployeesTable({
  rows,
  total,
  params,
  options,
  canManage,
}: {
  rows: EmployeeRow[];
  total: number;
  params: EmployeeTableParams;
  options: EmployeeFormOptions;
  canManage: boolean;
}) {
  const t = useTranslations("employees");
  const tStatus = useTranslations("employeeStatus");
  const tLevel = useTranslations("skillLevels");
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [archiving, setArchiving] = useState<EmployeeRow | null>(null);
  const [, startTransition] = useTransition();
  const archivedView = params.view === "archived";
  const filtered =
    params.q !== "" || params.department !== "" || params.skill !== "" || params.status !== "";

  const columns = useMemo<DataTableColumn<EmployeeRow>[]>(() => {
    const restore = (employee: EmployeeRow) =>
      startTransition(async () => {
        const result = await setEmployeeArchivedAction(employee.id, false);
        if (result.ok) toast.success(t("restoredToast", { name: fullName(employee) }));
        else toast.error(t(`form.errors.${result.error}`));
      });

    const base: DataTableColumn<EmployeeRow>[] = [
      {
        accessorKey: "employeeNumber",
        header: t("columns.number"),
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">{row.original.employeeNumber}</span>
        ),
      },
      {
        id: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{fullName(row.original)}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.user ? row.original.user.username : t("noAccount")}
            </span>
          </div>
        ),
      },
      {
        id: "department",
        header: t("columns.department"),
        cell: ({ row }) =>
          row.original.department || row.original.jobTitle ? (
            <div className="flex flex-col">
              <span>{row.original.department?.name ?? "—"}</span>
              <span className="text-xs text-muted-foreground">
                {row.original.jobTitle?.name ?? ""}
              </span>
            </div>
          ) : (
            muted
          ),
      },
      {
        id: "skills",
        header: t("columns.skills"),
        cell: ({ row }) => (
          <Chips
            items={row.original.skills.map(
              (skill) => `${skill.name} · ${tLevel(String(skill.level) as "1" | "2" | "3")}`,
            )}
            more={(count) => t("moreItems", { count })}
          />
        ),
      },
      {
        id: "machines",
        header: t("columns.machines"),
        cell: ({ row }) => (
          <Chips
            items={row.original.machines.map((machine) => machine.code)}
            more={(count) => t("moreItems", { count })}
          />
        ),
      },
      {
        id: "status",
        header: t("columns.status"),
        cell: ({ row }) =>
          row.original.status === "active" ? (
            <StatusBadge tone="success">{tStatus("active")}</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">{tStatus("inactive")}</StatusBadge>
          ),
      },
    ];
    if (!canManage) return base;

    return [
      ...base,
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => {
          const employee = row.original;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("rowActions.menu", { name: fullName(employee) })}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  {employee.archived ? (
                    <DropdownMenuItem onClick={() => restore(employee)}>
                      <RotateCcwIcon />
                      {t("rowActions.restore")}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => setEditing(employee)}>
                        <PencilIcon />
                        {t("rowActions.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setArchiving(employee)}
                      >
                        <ArchiveIcon />
                        {t("rowActions.archive")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ];
  }, [t, tStatus, tLevel, canManage]);

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
            id: "department",
            label: t("columns.department"),
            value: params.department,
            allLabel: t("filters.allDepartments"),
            options: options.departments.map((item) => ({ value: item.id, label: item.name })),
          },
          {
            id: "skill",
            label: t("columns.skills"),
            value: params.skill,
            allLabel: t("filters.allSkills"),
            options: options.skills.map((item) => ({ value: item.id, label: item.name })),
          },
          {
            id: "status",
            label: t("columns.status"),
            value: params.status,
            allLabel: t("filters.allStatuses"),
            options: EMPLOYEE_STATUSES.map((status) => ({ value: status, label: tStatus(status) })),
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
              icon={<HardHatIcon />}
              title={t("emptyTitle")}
              description={canManage ? t("emptyDescription") : t("emptyReadOnlyDescription")}
              className="border-0"
            />
          )
        }
      />
      {canManage ? (
        <>
          <EmployeeSheet
            open={editing !== null}
            onOpenChange={(open) => !open && setEditing(null)}
            employee={editing}
            options={options}
          />
          <ConfirmDialog
            open={archiving !== null}
            onOpenChange={(open) => !open && setArchiving(null)}
            title={t("archiveTitle", { name: archiving ? fullName(archiving) : "" })}
            description={t("archiveDescription")}
            confirmLabel={t("rowActions.archive")}
            destructive
            onConfirm={async () => {
              if (!archiving) return;
              const result = await setEmployeeArchivedAction(archiving.id, true);
              if (result.ok) toast.success(t("archivedToast", { name: fullName(archiving) }));
              else toast.error(t(`form.errors.${result.error}`));
            }}
          />
        </>
      ) : null}
    </>
  );
}
