"use client";

import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FactoryIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type DragEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDecimals, compareDecimals, formatDecimal, parseDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import type { CatalogOption } from "@/modules/catalogs/queries";
import { reorderOperationsAction, setOperationArchivedAction } from "@/modules/products/actions";
import type { MachineChoice, OperationType, ProductOperation } from "@/modules/products/queries";
import {
  moveInOrder,
  operationSeconds,
  resolveCycleUnit,
  routingTotals,
  secondsToUnit,
  splitDuration,
  type TimeUnit,
} from "@/modules/products/rules";
import type { OperationActionResult } from "@/modules/products/schemas";
import { OperationSheet } from "./operation-sheet";

const muted = <span className="text-muted-foreground">—</span>;

export function OperationsPanel({
  revisionId,
  operations,
  operationTypes,
  machineTypes,
  machines,
  defaultUnit,
  editable,
}: {
  revisionId: string;
  operations: ProductOperation[];
  operationTypes: OperationType[];
  machineTypes: CatalogOption[];
  machines: MachineChoice[];
  defaultUnit: TimeUnit;
  editable: boolean;
}) {
  const t = useTranslations("products.operations");
  const tErrors = useTranslations("products.operations.form.errors");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProductOperation | "new" | null>(null);
  const [archiving, setArchiving] = useState<ProductOperation | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  // Optimistic order of the manual operations while a reorder is saved.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  const active = operations.filter((op) => !op.archived);
  const manual = active.filter((op) => !op.autoInspection);
  const manualIds = manual.map((op) => op.id);
  const ordered = pendingOrder
    ? [
        ...pendingOrder.flatMap((id) => manual.filter((op) => op.id === id)),
        ...active.filter((op) => op.autoInspection),
      ]
    : active;
  const visible = showArchived ? [...ordered, ...operations.filter((op) => op.archived)] : ordered;
  const archivedCount = operations.length - active.length;

  const unitOf = (op: ProductOperation) =>
    resolveCycleUnit(op.machine?.cycleTimeUnit ?? null, defaultUnit);
  const totals = routingTotals(active);
  const quantityValue = parseDecimal(quantity, 3);
  const parsedQuantity =
    quantityValue !== null && compareDecimals(quantityValue, "0") > 0 ? quantityValue : null;
  const totalForQuantity =
    parsedQuantity === null
      ? null
      : splitDuration(addDecimals(active.map((op) => operationSeconds(op, parsedQuantity))));

  const run = (action: () => Promise<OperationActionResult>, success?: string) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (success) toast.success(success);
      } else {
        toast.error(tErrors(result.error));
      }
    });

  const reorder = (order: string[]) => {
    if (order.join() === manualIds.join()) return;
    setPendingOrder(order);
    startTransition(async () => {
      const result = await reorderOperationsAction(revisionId, order);
      if (!result.ok) toast.error(tErrors(result.error));
      setPendingOrder(null);
    });
  };

  const duration = (seconds: string) => {
    const { hours, minutes, seconds: secs } = splitDuration(seconds);
    return t("duration", { hours, minutes, seconds: secs });
  };

  const draggable = (op: ProductOperation) => editable && !op.archived && !op.autoInspection;
  const onDragOver = (event: DragEvent<HTMLTableRowElement>, op: ProductOperation) => {
    if (!dragging || !draggable(op) || op.id === dragging) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    if (dropTarget?.id !== op.id || dropTarget.after !== after) setDropTarget({ id: op.id, after });
  };
  const onDrop = (event: DragEvent<HTMLTableRowElement>) => {
    event.preventDefault();
    if (dragging && dropTarget) {
      const without = (pendingOrder ?? manualIds).filter((id) => id !== dragging);
      const index = without.indexOf(dropTarget.id) + (dropTarget.after ? 1 : 0);
      reorder([...without.slice(0, index), dragging, ...without.slice(index)]);
    }
    setDragging(null);
    setDropTarget(null);
  };

  const sheet = editable ? (
    <OperationSheet
      open={editing !== null}
      onOpenChange={(open) => !open && setEditing(null)}
      revisionId={revisionId}
      operation={editing === "new" ? null : editing}
      operationTypes={operationTypes}
      machineTypes={machineTypes}
      machines={machines}
      defaultUnit={defaultUnit}
    />
  ) : null;

  if (operations.length === 0) {
    return (
      <>
        <EmptyState
          icon={<WorkflowIcon />}
          title={t("emptyTitle")}
          description={editable ? t("emptyDescription") : t("emptyReadOnlyDescription")}
          action={
            editable ? (
              <Button onClick={() => setEditing("new")}>
                <PlusIcon />
                {t("add")}
              </Button>
            ) : null
          }
        />
        {sheet}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4">
          {editable && manual.length > 1 ? (
            <span className="text-sm text-muted-foreground">{t("dragHint")}</span>
          ) : null}
          {archivedCount > 0 ? (
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox
                checked={showArchived}
                onCheckedChange={(value) => setShowArchived(value === true)}
              />
              {t("showArchived", { count: archivedCount })}
            </Label>
          ) : null}
        </div>
        {editable ? (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("add")}
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {editable ? (
                <TableHead className="w-8">
                  <span className="sr-only">{t("columns.drag")}</span>
                </TableHead>
              ) : null}
              <TableHead className="w-24">{t("columns.code")}</TableHead>
              <TableHead>{t("columns.operation")}</TableHead>
              <TableHead>{t("columns.resource")}</TableHead>
              <TableHead className="text-right">{t("columns.setup")}</TableHead>
              <TableHead className="text-right">{t("columns.cycle")}</TableHead>
              <TableHead>{t("columns.notes")}</TableHead>
              {editable ? (
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={editable ? 8 : 6} className="text-center text-muted-foreground">
                  {t("allArchived")}
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((op) => {
              const unit = unitOf(op);
              const position = (pendingOrder ?? manualIds).indexOf(op.id);
              const move = (direction: -1 | 1) =>
                reorder(moveInOrder(pendingOrder ?? manualIds, op.id, direction));
              return (
                <TableRow
                  key={op.id}
                  draggable={draggable(op) && !pending}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(op.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(event) => onDragOver(event, op)}
                  onDrop={onDrop}
                  className={cn(
                    op.archived && "opacity-60",
                    op.autoInspection && "bg-muted/30",
                    dragging === op.id && "opacity-40",
                    dropTarget?.id === op.id &&
                      (dropTarget.after
                        ? "shadow-[inset_0_-2px_0_var(--color-primary)]"
                        : "shadow-[inset_0_2px_0_var(--color-primary)]"),
                  )}
                >
                  {editable ? (
                    <TableCell className="w-8 pr-0">
                      {draggable(op) ? (
                        <GripVerticalIcon
                          className="size-4 cursor-grab text-muted-foreground"
                          aria-hidden
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {op.type.code}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{op.type.name}</span>
                        {op.autoInspection ? (
                          <Badge variant="secondary" className="gap-1">
                            <ShieldCheckIcon className="size-3" aria-hidden />
                            {t("autoInspection")}
                          </Badge>
                        ) : null}
                        {op.archived ? (
                          <Badge variant="secondary">{t("archivedBadge")}</Badge>
                        ) : null}
                      </span>
                      {op.description ? (
                        <span className="text-xs text-muted-foreground">{op.description}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {op.type.isExternal ? (
                      <span className="flex items-center gap-1">
                        <FactoryIcon className="size-4 text-muted-foreground" aria-hidden />
                        {op.externalCompany ?? t("externalNoCompany")}
                      </span>
                    ) : op.machine ? (
                      <span>
                        <span className="font-mono">{op.machine.code}</span> {op.machine.name}
                      </span>
                    ) : op.machineType ? (
                      t("machineTypeValue", { name: op.machineType.name })
                    ) : (
                      muted
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {op.setupTimeMin !== null
                      ? t("minutesValue", { value: formatDecimal(op.setupTimeMin) })
                      : muted}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {op.cycleTimeS !== null
                      ? t(unit === "s" ? "secondsValue" : "minutesValue", {
                          value: formatDecimal(secondsToUnit(op.cycleTimeS, unit)),
                        })
                      : muted}
                  </TableCell>
                  <TableCell className="max-w-64">
                    {op.notes ? (
                      <span className="line-clamp-2 text-sm whitespace-pre-line">{op.notes}</span>
                    ) : (
                      muted
                    )}
                  </TableCell>
                  {editable ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {op.autoInspection ? null : op.archived ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={pending}
                            aria-label={t("restore", { name: op.type.name })}
                            onClick={() =>
                              run(
                                () => setOperationArchivedAction(op.id, false),
                                t("restoredToast", { name: op.type.name }),
                              )
                            }
                          >
                            <RotateCcwIcon />
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending || position <= 0}
                              aria-label={t("moveUp", { name: op.type.name })}
                              onClick={() => move(-1)}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending || position === manual.length - 1}
                              aria-label={t("moveDown", { name: op.type.name })}
                              onClick={() => move(1)}
                            >
                              <ArrowDownIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("edit", { name: op.type.name })}
                              onClick={() => setEditing(op)}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("archive", { name: op.type.name })}
                              onClick={() => setArchiving(op)}
                            >
                              <ArchiveIcon />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={editable ? 4 : 3}>{t("totals")}</TableCell>
              <TableCell className="text-right tabular-nums">
                {duration(totals.setupSeconds)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {duration(totals.cycleSecondsPerPiece)}
              </TableCell>
              <TableCell colSpan={editable ? 2 : 1} className="text-muted-foreground">
                {t("totalsHint")}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <Field className="w-40">
          <FieldLabel htmlFor="operations-quantity">{t("calculator.quantity")}</FieldLabel>
          <Input
            id="operations-quantity"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-invalid={parsedQuantity === null || undefined}
          />
        </Field>
        <p className="pb-2 text-sm">
          {totalForQuantity
            ? t("calculator.result", {
                quantity: formatDecimal(parsedQuantity),
                hours: totalForQuantity.hours,
                minutes: totalForQuantity.minutes,
                seconds: totalForQuantity.seconds,
              })
            : t("calculator.invalid")}
        </p>
      </div>

      {sheet}
      {editable ? (
        <ConfirmDialog
          open={archiving !== null}
          onOpenChange={(open) => !open && setArchiving(null)}
          title={t("archiveTitle", { name: archiving?.type.name ?? "" })}
          description={t("archiveDescription")}
          confirmLabel={t("archiveConfirm")}
          destructive
          onConfirm={async () => {
            if (!archiving) return;
            const result = await setOperationArchivedAction(archiving.id, true);
            if (result.ok) toast.success(t("archivedToast", { name: archiving.type.name }));
            else toast.error(tErrors(result.error));
          }}
        />
      ) : null}
    </div>
  );
}
