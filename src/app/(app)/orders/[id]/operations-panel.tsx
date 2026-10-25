"use client";

import {
  ArchiveIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  TriangleAlertIcon,
  UserCogIcon,
  WorkflowIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Duration } from "@/components/shared/duration";
import { EmptyState } from "@/components/shared/empty-state";
import { OperationStatusBadge } from "@/components/shared/order-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDecimals, formatDecimal } from "@/lib/decimal";
import { formatLocalDateTime } from "@/lib/format";
import { utcToZonedLocal } from "@/lib/timezone";
import {
  setOperationArchivedAction,
  setOperationStatusAction,
} from "@/modules/production-orders/actions";
import type { OrderOperation } from "@/modules/production-orders/queries";
import {
  canChangeOperationStatus,
  canChangeRouting,
  canEditPlanning,
  CLOSED_STATUSES,
  operationTargets,
  type OperationStatus,
  type OrderStatus,
} from "@/modules/production-orders/status-rules";
import type { OperationType } from "@/modules/products/queries";
import { resolveCycleUnit, secondsToUnit, type TimeUnit } from "@/modules/products/rules";
import { AssignmentSheet, type AssignmentOptions } from "./assignment-sheet";
import { OrderOperationSheet } from "./order-operation-sheet";

const muted = <span className="text-muted-foreground">—</span>;

export function OperationsPanel({
  orderId,
  orderStatus,
  operations,
  operationTypes,
  assignment,
  defaultUnit,
  canManage,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  operations: OrderOperation[];
  operationTypes: OperationType[];
  assignment: AssignmentOptions;
  defaultUnit: TimeUnit;
  canManage: boolean;
}) {
  const t = useTranslations("orders.operations");
  const tStatus = useTranslations("operationStatus");
  const tExternal = useTranslations("externalOperationStatus");
  const router = useRouter();
  const [assigning, setAssigning] = useState<OrderOperation | null>(null);
  const [editing, setEditing] = useState<OrderOperation | "new" | null>(null);
  const [removing, setRemoving] = useState<OrderOperation | null>(null);
  const [, startTransition] = useTransition();

  const active = operations.filter((op) => !op.archived);
  const closed = CLOSED_STATUSES.includes(orderStatus);
  const routing = canManage && canChangeRouting(orderStatus);
  const planning = canManage && canEditPlanning(orderStatus);
  const statusChanges = canManage && canChangeOperationStatus(orderStatus);
  const total = addDecimals(active.map((op) => op.plannedSeconds));

  const cycleLabel = (op: OrderOperation) => {
    if (!op.cycleTimeS) return null;
    const unit = resolveCycleUnit(op.machine?.cycleTimeUnit ?? null, defaultUnit);
    return `${formatDecimal(secondsToUnit(op.cycleTimeS, unit))} ${unit === "s" ? "s" : "min"}`;
  };

  const period = (op: OrderOperation) => {
    if (!op.plannedStart && !op.plannedEnd) return null;
    const show = (iso: string | null) =>
      iso ? formatLocalDateTime(utcToZonedLocal(iso, assignment.timezone)) : "…";
    return `${show(op.plannedStart)} – ${show(op.plannedEnd)}`;
  };

  const changeStatus = (op: OrderOperation, status: OperationStatus) =>
    startTransition(async () => {
      const result = await setOperationStatusAction(op.id, status);
      if (result.ok) {
        toast.success(
          t("statusToast", {
            code: op.type.code,
            status: op.type.isExternal ? tExternal(status) : tStatus(status),
          }),
        );
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {routing ? t("draftHint") : closed ? t("closedHint") : t("releasedHint")}
          {!closed && active.some((op) => op.type.isExternal) ? ` ${t("externalHint")}` : null}
        </p>
        {routing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("add")}
          </Button>
        ) : null}
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={<WorkflowIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t("columns.operation")}</TableHead>
                <TableHead>{t("columns.machine")}</TableHead>
                <TableHead>{t("columns.workers")}</TableHead>
                <TableHead>{t("columns.times")}</TableHead>
                <TableHead className="text-right">{t("columns.planned")}</TableHead>
                <TableHead>{t("columns.production")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                {canManage && !closed ? (
                  <TableHead>
                    <span className="sr-only">{t("columns.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((op, index) => {
                const targets = operationTargets(op.status, op.type.isExternal);
                const assignable =
                  canManage && !closed && op.status !== "done" && !op.type.isExternal;
                return (
                  <TableRow key={op.id} data-testid={`order-operation-${op.type.code}`}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="font-mono">
                            {op.type.code}
                          </Badge>
                          <span className="font-medium">{op.type.name}</span>
                          {op.type.isCutting ? (
                            <Badge variant="secondary">{t("cutting")}</Badge>
                          ) : null}
                        </span>
                        {op.description ? (
                          <span className="text-xs text-muted-foreground">{op.description}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {op.type.isExternal ? (
                        <span className="text-sm">
                          {t("external", { company: op.externalCompany ?? "—" })}
                        </span>
                      ) : op.machine ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1">
                            <span className="font-mono text-sm">{op.machine.code}</span>
                            {op.machineTypeMismatch ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <TriangleAlertIcon
                                      className="size-4 text-amber-600"
                                      aria-label={t("typeMismatch")}
                                    />
                                  }
                                />
                                <TooltipContent>
                                  {t("typeMismatchHint", { type: op.machineType?.name ?? "" })}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </span>
                          {op.overlapCount > 0 ? (
                            <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                              <CalendarClockIcon className="size-3.5" aria-hidden />
                              {t("overlaps", { count: op.overlapCount })}
                            </span>
                          ) : null}
                        </div>
                      ) : op.type.isInspection ? (
                        muted
                      ) : (
                        <span className="text-sm text-amber-700 dark:text-amber-300">
                          {op.machineType
                            ? t("toAssignType", { type: op.machineType.name })
                            : t("toAssign")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {op.workers.length > 0 ? (
                        <span className="text-sm">{op.workers.map((w) => w.name).join(", ")}</span>
                      ) : op.type.isExternal ? (
                        muted
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {op.type.isInspection ? t("noInspector") : t("allQualified")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm tabular-nums">
                        {op.setupTimeMin || op.cycleTimeS ? (
                          <span>
                            {t("setupCycle", {
                              setup: formatDecimal(op.setupTimeMin ?? "0"),
                              cycle: cycleLabel(op) ?? "—",
                            })}
                          </span>
                        ) : (
                          muted
                        )}
                        {period(op) ? (
                          <span className="text-xs text-muted-foreground">{period(op)}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Duration seconds={op.plannedSeconds} />
                    </TableCell>
                    <TableCell>
                      <OperationProduction op={op} />
                    </TableCell>
                    <TableCell>
                      {statusChanges && targets.length > 0 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md"
                                aria-label={t("changeStatus", { code: op.type.code })}
                              />
                            }
                          >
                            <OperationStatusBadge
                              status={op.status}
                              external={op.type.isExternal}
                            />
                            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {targets.map((to) => (
                              <DropdownMenuItem key={to} onClick={() => changeStatus(op, to)}>
                                {op.type.isExternal ? tExternal(to) : tStatus(to)}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <OperationStatusBadge status={op.status} external={op.type.isExternal} />
                      )}
                    </TableCell>
                    {canManage && !closed ? (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {assignable ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("assign", { code: op.type.code })}
                              onClick={() => setAssigning(op)}
                            >
                              <UserCogIcon />
                            </Button>
                          ) : null}
                          {planning ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("edit", { code: op.type.code })}
                              onClick={() => setEditing(op)}
                            >
                              <PencilIcon />
                            </Button>
                          ) : null}
                          {routing ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("remove", { code: op.type.code })}
                              onClick={() => setRemoving(op)}
                            >
                              <ArchiveIcon />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5}>{t("total")}</TableCell>
                <TableCell className="text-right font-medium">
                  <Duration seconds={total} />
                </TableCell>
                <TableCell colSpan={canManage && !closed ? 2 : 1} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {canManage ? (
        <>
          <AssignmentSheet
            operation={assigning}
            options={assignment}
            onOpenChange={(open) => !open && setAssigning(null)}
          />
          <OrderOperationSheet
            open={editing !== null}
            onOpenChange={(open) => !open && setEditing(null)}
            orderId={orderId}
            operation={editing === "new" ? null : editing}
            operationTypes={operationTypes}
            machines={assignment.machines}
            defaultUnit={defaultUnit}
          />
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(open) => !open && setRemoving(null)}
            title={t("removeTitle", { code: removing?.type.code ?? "" })}
            description={t("removeDescription")}
            confirmLabel={t("removeConfirm")}
            destructive
            onConfirm={async () => {
              if (!removing) return;
              const result = await setOperationArchivedAction(removing.id, true);
              if (result.ok) {
                toast.success(t("removedToast", { code: removing.type.code }));
                router.refresh();
              } else {
                toast.error(t(`errors.${result.error}`));
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/** Reported pieces and actual times of an operation (machine time ≠ worker time). */
function OperationProduction({ op }: { op: OrderOperation }) {
  const t = useTranslations("orders.operations.production");
  const reported = addDecimals([op.goodQuantity, op.scrapQuantity], 3) !== "0";
  const worked = op.runSeconds !== "0" || op.workerSeconds !== "0";
  if (op.type.isExternal) {
    // Shipped ("in progress") until received: time at the other company.
    return op.runSeconds === "0" ? (
      <span className="text-sm text-muted-foreground">—</span>
    ) : (
      <span className="text-xs text-muted-foreground tabular-nums">
        {t("atSupplier")} <Duration seconds={op.runSeconds} />
      </span>
    );
  }
  if (!reported && !worked) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-sm tabular-nums">
      {reported ? (
        <span data-testid={`operation-pieces-${op.type.code}`}>
          {t("pieces", {
            good: formatDecimal(op.goodQuantity),
            scrap: formatDecimal(op.scrapQuantity),
            input: formatDecimal(op.inputQuantity),
          })}
        </span>
      ) : null}
      {worked ? (
        <span className="text-xs text-muted-foreground">
          {t("machine")} <Duration seconds={op.runSeconds} /> · {t("workers")}{" "}
          <Duration seconds={op.workerSeconds} />
          {op.downtimeSeconds !== "0" ? (
            <>
              {" "}
              · {t("downtime")} <Duration seconds={op.downtimeSeconds} />
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
