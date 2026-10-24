"use client";

import {
  ArchiveIcon,
  CogIcon,
  EllipsisIcon,
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
import { MachineStatusBadge } from "@/components/shared/machine-status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setMachineArchivedAction, setMachineStatusAction } from "@/modules/machines/actions";
import type { MachineRow } from "@/modules/machines/queries";
import { MACHINE_STATUSES, machineStatusSchema } from "@/modules/machines/schemas";
import { MachineSheet, type MachineCatalogs } from "./machine-sheet";

export type MachineTableParams = {
  page: number;
  pageSize: number;
  q: string;
  status: string;
  type: string;
  location: string;
  view: string;
};

const muted = <span className="text-muted-foreground">—</span>;

export function MachinesTable({
  rows,
  total,
  params,
  catalogs,
  canManage,
}: {
  rows: MachineRow[];
  total: number;
  params: MachineTableParams;
  catalogs: MachineCatalogs;
  canManage: boolean;
}) {
  const t = useTranslations("machines");
  const tStatus = useTranslations("machineStatus");
  const [editing, setEditing] = useState<MachineRow | null>(null);
  const [archiving, setArchiving] = useState<MachineRow | null>(null);
  const [, startTransition] = useTransition();
  const archivedView = params.view === "archived";
  const filtered =
    params.q !== "" || params.status !== "" || params.type !== "" || params.location !== "";

  const columns = useMemo<DataTableColumn<MachineRow>[]>(() => {
    const changeStatus = (machine: MachineRow, value: unknown) => {
      const status = machineStatusSchema.safeParse(value);
      if (!status.success || status.data === machine.status) return;
      startTransition(async () => {
        const result = await setMachineStatusAction(machine.id, status.data);
        if (result.ok) {
          toast.success(
            t("statusChangedToast", { code: machine.code, status: tStatus(status.data) }),
          );
        } else {
          toast.error(t(`form.errors.${result.error}`));
        }
      });
    };

    const restore = (machine: MachineRow) =>
      startTransition(async () => {
        const result = await setMachineArchivedAction(machine.id, false);
        if (result.ok) toast.success(t("restoredToast", { code: machine.code }));
        else toast.error(t(`form.errors.${result.error}`));
      });

    const base: DataTableColumn<MachineRow>[] = [
      {
        accessorKey: "code",
        header: t("columns.code"),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      },
      { accessorKey: "name", header: t("columns.name") },
      {
        id: "type",
        header: t("columns.type"),
        cell: ({ row }) => row.original.type?.name ?? muted,
      },
      {
        id: "manufacturer",
        header: t("columns.manufacturer"),
        cell: ({ row }) => {
          const text = [row.original.manufacturer, row.original.model].filter(Boolean).join(" ");
          return text || muted;
        },
      },
      {
        id: "location",
        header: t("columns.location"),
        cell: ({ row }) => row.original.location?.name ?? muted,
      },
      {
        id: "status",
        header: t("columns.status"),
        cell: ({ row }) => <MachineStatusBadge status={row.original.status} />,
      },
    ];
    if (!canManage) return base;

    return [
      ...base,
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => {
          const machine = row.original;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("rowActions.menu", { code: machine.code })}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {machine.archived ? (
                    <DropdownMenuItem onClick={() => restore(machine)}>
                      <RotateCcwIcon />
                      {t("rowActions.restore")}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => setEditing(machine)}>
                        <PencilIcon />
                        {t("rowActions.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <CogIcon />
                          {t("rowActions.setStatus")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>{t("columns.status")}</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={machine.status}
                              onValueChange={(value) => changeStatus(machine, value)}
                            >
                              {MACHINE_STATUSES.map((status) => (
                                <DropdownMenuRadioItem key={status} value={status}>
                                  {tStatus(status)}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setArchiving(machine)}>
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
  }, [t, tStatus, canManage]);

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
            id: "status",
            label: t("columns.status"),
            value: params.status,
            allLabel: t("filters.allStatuses"),
            options: MACHINE_STATUSES.map((status) => ({ value: status, label: tStatus(status) })),
          },
          {
            id: "type",
            label: t("columns.type"),
            value: params.type,
            allLabel: t("filters.allTypes"),
            options: catalogs.types.map((item) => ({ value: item.id, label: item.name })),
          },
          {
            id: "location",
            label: t("columns.location"),
            value: params.location,
            allLabel: t("filters.allLocations"),
            options: catalogs.locations.map((item) => ({ value: item.id, label: item.name })),
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
              icon={<CogIcon />}
              title={t("emptyTitle")}
              description={canManage ? t("emptyDescription") : t("emptyReadOnlyDescription")}
              className="border-0"
            />
          )
        }
      />
      {canManage ? (
        <>
          <MachineSheet
            open={editing !== null}
            onOpenChange={(open) => !open && setEditing(null)}
            machine={editing}
            catalogs={catalogs}
          />
          <ConfirmDialog
            open={archiving !== null}
            onOpenChange={(open) => !open && setArchiving(null)}
            title={t("archiveTitle", { code: archiving?.code ?? "" })}
            description={t("archiveDescription")}
            confirmLabel={t("rowActions.archive")}
            destructive
            onConfirm={async () => {
              if (!archiving) return;
              const result = await setMachineArchivedAction(archiving.id, true);
              if (result.ok) toast.success(t("archivedToast", { code: archiving.code }));
              else toast.error(t(`form.errors.${result.error}`));
            }}
          />
        </>
      ) : null}
    </>
  );
}
