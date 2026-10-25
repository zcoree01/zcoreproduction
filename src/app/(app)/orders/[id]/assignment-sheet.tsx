"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { utcToZonedLocal } from "@/lib/timezone";
import { assignOperationAction } from "@/modules/production-orders/actions";
import type {
  EmployeeChoice,
  MachineChoice,
  OrderOperation,
} from "@/modules/production-orders/queries";
import type { AssignmentField } from "@/modules/production-orders/schemas";

export type AssignmentOptions = {
  machines: MachineChoice[];
  employees: EmployeeChoice[];
  timezone: string;
};

export function AssignmentSheet({
  operation,
  options,
  onOpenChange,
}: {
  operation: OrderOperation | null;
  options: AssignmentOptions;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={operation !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        {operation ? (
          <AssignmentForm
            key={operation.id}
            operation={operation}
            options={options}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AssignmentForm({
  operation,
  options,
  onDone,
}: {
  operation: OrderOperation;
  options: AssignmentOptions;
  onDone: () => void;
}) {
  const t = useTranslations("orders.assignment");
  const router = useRouter();
  const [machineId, setMachineId] = useState(operation.machine?.id ?? "");
  const [workerIds, setWorkerIds] = useState<string[]>(
    operation.workers.map((worker) => worker.employeeId),
  );
  const toLocal = (iso: string | null) => (iso ? utcToZonedLocal(iso, options.timezone) : "");
  const [plannedStart, setPlannedStart] = useState(toLocal(operation.plannedStart));
  const [plannedEnd, setPlannedEnd] = useState(toLocal(operation.plannedEnd));
  const [invalid, setInvalid] = useState<AssignmentField[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inspection = operation.type.isInspection;
  const machine = options.machines.find((m) => m.id === machineId) ?? null;
  const typeMismatch =
    machine !== null &&
    operation.machineType !== null &&
    machine.type?.id !== operation.machineType.id;
  // Who may be assigned: inspectors for inspections, otherwise workers
  // qualified for the chosen machine (the database checks the same).
  const candidates = options.employees.filter((employee) =>
    inspection ? employee.isInspector : machineId !== "" && employee.machineIds.includes(machineId),
  );
  const assignedElsewhere = workerIds.filter((id) => !candidates.some((c) => c.id === id));
  // Preferred machines (the planned type) first.
  const machines = [...options.machines].sort(
    (a, b) =>
      Number(b.type?.id === operation.machineType?.id) -
      Number(a.type?.id === operation.machineType?.id),
  );

  const toggle = (id: string, checked: boolean) =>
    setWorkerIds((current) =>
      checked ? [...current, id] : current.filter((candidate) => candidate !== id),
    );

  const save = () => {
    setFormError(null);
    setInvalid([]);
    startTransition(async () => {
      const result = await assignOperationAction(operation.id, {
        machineId,
        employeeIds: workerIds.filter((id) => !assignedElsewhere.includes(id)),
        plannedStart,
        plannedEnd,
      });
      if (!result.ok) {
        if (result.fields.length > 0) setInvalid(result.fields);
        setFormError(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("savedToast"));
      if (result.warnings.machineTypeMismatch) toast.warning(t("typeMismatchToast"));
      if (result.warnings.overlaps.length > 0) {
        toast.warning(
          t("overlapToast", {
            orders: result.warnings.overlaps
              .map((o) => `${o.orderNumber} (${o.operationCode})`)
              .join(", "),
          }),
        );
      }
      onDone();
      router.refresh();
    });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {t("title", { code: operation.type.code, name: operation.type.name })}
        </SheetTitle>
        <SheetDescription>
          {inspection ? t("descriptionInspection") : t("description")}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={invalid.includes("machineId") || undefined}>
            <FieldLabel htmlFor="assignment-machine">{t("machine")}</FieldLabel>
            <NativeSelect
              id="assignment-machine"
              className="w-full"
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
            >
              <NativeSelectOption value="">
                {inspection ? t("noMachineInspection") : t("noMachine")}
              </NativeSelectOption>
              {machines.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.code} · {m.name}
                  {m.type ? ` (${m.type.name})` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {operation.machineType ? (
              <FieldDescription>
                {t("plannedType", { type: operation.machineType.name })}
              </FieldDescription>
            ) : null}
            {typeMismatch ? (
              <Alert className="mt-1">
                <TriangleAlertIcon />
                <AlertTitle>{t("typeMismatchTitle")}</AlertTitle>
                <AlertDescription>
                  {t("typeMismatch", { type: operation.machineType?.name ?? "" })}
                </AlertDescription>
              </Alert>
            ) : null}
          </Field>

          <FieldSet data-invalid={invalid.includes("employeeIds") || undefined}>
            <FieldLegend variant="label">{t("workers")}</FieldLegend>
            <FieldDescription>{t("workersHint")}</FieldDescription>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {inspection
                  ? t("noInspectors")
                  : machineId === ""
                    ? t("chooseMachineFirst")
                    : t("noQualified")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {candidates.map((employee) => (
                  <Field key={employee.id} orientation="horizontal">
                    <Checkbox
                      id={`assignment-worker-${employee.id}`}
                      checked={workerIds.includes(employee.id)}
                      onCheckedChange={(checked) => toggle(employee.id, checked === true)}
                    />
                    <FieldLabel htmlFor={`assignment-worker-${employee.id}`}>
                      {employee.name}
                      <span className="text-muted-foreground tabular-nums">
                        #{employee.employeeNumber}
                      </span>
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            )}
            {assignedElsewhere.length > 0 ? (
              <FieldDescription>
                {t("droppedWorkers", { count: assignedElsewhere.length })}
              </FieldDescription>
            ) : null}
            {invalid.includes("employeeIds") ? (
              <FieldError>{t("workersInvalid")}</FieldError>
            ) : null}
          </FieldSet>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={invalid.includes("plannedStart") || undefined}>
              <FieldLabel htmlFor="assignment-start">{t("plannedStart")}</FieldLabel>
              <Input
                id="assignment-start"
                type="datetime-local"
                value={plannedStart}
                onChange={(event) => setPlannedStart(event.target.value)}
              />
            </Field>
            <Field data-invalid={invalid.includes("plannedEnd") || undefined}>
              <FieldLabel htmlFor="assignment-end">{t("plannedEnd")}</FieldLabel>
              <Input
                id="assignment-end"
                type="datetime-local"
                value={plannedEnd}
                onChange={(event) => setPlannedEnd(event.target.value)}
              />
              {invalid.includes("plannedEnd") ? (
                <FieldError>{t("plannedEndInvalid")}</FieldError>
              ) : null}
            </Field>
          </div>
          <FieldDescription>{t("plannedHint")}</FieldDescription>
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button onClick={save} disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </SheetFooter>
    </>
  );
}
