"use client";

import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FactoryIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  WorkflowIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
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
import type { CatalogOption } from "@/modules/catalogs/queries";
import { moveOperationAction, setOperationArchivedAction } from "@/modules/products/actions";
import type { MachineChoice, OperationType, ProductOperation } from "@/modules/products/queries";
import {
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
  const [pending, startTransition] = useTransition();

  const active = useMemo(() => operations.filter((op) => !op.archived), [operations]);
  const visible = showArchived ? operations : active;
  const archivedCount = operations.length - active.length;
  const nextSequence = Math.min(
    9999,
    Math.ceil((Math.max(0, ...operations.map((op) => op.sequence)) + 1) / 10) * 10,
  );

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

  const duration = (seconds: string) => {
    const { hours, minutes, seconds: secs } = splitDuration(seconds);
    return t("duration", { hours, minutes, seconds: secs });
  };

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
        {editable ? (
          <OperationSheet
            open={editing !== null}
            onOpenChange={(open) => !open && setEditing(null)}
            revisionId={revisionId}
            operation={null}
            nextSequence={nextSequence}
            operationTypes={operationTypes}
            machineTypes={machineTypes}
            machines={machines}
            defaultUnit={defaultUnit}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {archivedCount > 0 ? (
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={showArchived}
              onCheckedChange={(value) => setShowArchived(value === true)}
            />
            {t("showArchived", { count: archivedCount })}
          </Label>
        ) : (
          <span />
        )}
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
              <TableHead className="w-16">{t("columns.sequence")}</TableHead>
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
                <TableCell colSpan={editable ? 7 : 6} className="text-center text-muted-foreground">
                  {t("allArchived")}
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((op) => {
              const unit = unitOf(op);
              const position = active.indexOf(op);
              return (
                <TableRow key={op.id} className={op.archived ? "opacity-60" : undefined}>
                  <TableCell className="font-mono tabular-nums">{op.sequence}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {op.type.code}
                        </Badge>
                        <span className="font-medium">{op.type.name}</span>
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
                        {op.archived ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={pending}
                            aria-label={t("restore", { sequence: op.sequence })}
                            onClick={() =>
                              run(
                                () => setOperationArchivedAction(op.id, false),
                                t("restoredToast", { sequence: op.sequence }),
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
                              aria-label={t("moveUp", { sequence: op.sequence })}
                              onClick={() => run(() => moveOperationAction(op.id, -1))}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending || position === active.length - 1}
                              aria-label={t("moveDown", { sequence: op.sequence })}
                              onClick={() => run(() => moveOperationAction(op.id, 1))}
                            >
                              <ArrowDownIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("edit", { sequence: op.sequence })}
                              onClick={() => setEditing(op)}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("archive", { sequence: op.sequence })}
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
              <TableCell colSpan={3}>{t("totals")}</TableCell>
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

      {editable ? (
        <>
          <OperationSheet
            open={editing !== null}
            onOpenChange={(open) => !open && setEditing(null)}
            revisionId={revisionId}
            operation={editing === "new" ? null : editing}
            nextSequence={nextSequence}
            operationTypes={operationTypes}
            machineTypes={machineTypes}
            machines={machines}
            defaultUnit={defaultUnit}
          />
          <ConfirmDialog
            open={archiving !== null}
            onOpenChange={(open) => !open && setArchiving(null)}
            title={t("archiveTitle", { sequence: archiving?.sequence ?? 0 })}
            description={t("archiveDescription")}
            confirmLabel={t("archiveConfirm")}
            destructive
            onConfirm={async () => {
              if (!archiving) return;
              const result = await setOperationArchivedAction(archiving.id, true);
              if (result.ok) toast.success(t("archivedToast", { sequence: archiving.sequence }));
              else toast.error(tErrors(result.error));
            }}
          />
        </>
      ) : null}
    </div>
  );
}
