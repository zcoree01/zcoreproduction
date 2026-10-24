"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch, type FieldError as FormFieldError } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDecimal } from "@/lib/decimal";
import type { CatalogOption } from "@/modules/catalogs/queries";
import { saveOperationAction } from "@/modules/products/actions";
import type { MachineChoice, OperationType, ProductOperation } from "@/modules/products/queries";
import { resolveCycleUnit, secondsToUnit, type TimeUnit } from "@/modules/products/rules";
import {
  validOperationSchema,
  type OperationActionResult,
  type OperationField,
  type OperationFormValues,
  type OperationInput,
} from "@/modules/products/schemas";

type FormError = Extract<OperationActionResult, { ok: false }>["error"];

type Props = {
  revisionId: string;
  operation: ProductOperation | null;
  nextSequence: number;
  operationTypes: OperationType[];
  machineTypes: CatalogOption[];
  machines: MachineChoice[];
  defaultUnit: TimeUnit;
};

export function OperationSheet({
  open,
  onOpenChange,
  ...props
}: Props & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        {open ? (
          <OperationForm
            key={props.operation?.id ?? "new"}
            {...props}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function resourceValue(operation: ProductOperation): string {
  if (operation.machine) return `machine:${operation.machine.id}`;
  if (operation.machineType) return `type:${operation.machineType.id}`;
  return "";
}

function OperationForm({
  revisionId,
  operation,
  nextSequence,
  operationTypes,
  machineTypes,
  machines,
  defaultUnit,
  onDone,
}: Props & { onDone: () => void }) {
  const t = useTranslations("products.operations.form");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();

  // Unit follows the selected machine (its own unit) or the organization default.
  const unitFor = (resource: string): TimeUnit => {
    const machineId = resource.startsWith("machine:") ? resource.slice("machine:".length) : null;
    const machine = machines.find((m) => m.id === machineId);
    return resolveCycleUnit(
      machine?.cycleTimeUnit ?? operation?.machine?.cycleTimeUnit ?? null,
      defaultUnit,
    );
  };

  const initialResource = operation ? resourceValue(operation) : "";
  const initialUnit = unitFor(initialResource);
  const initialCycle =
    operation?.cycleTimeS != null
      ? formatDecimal(secondsToUnit(operation.cycleTimeS, initialUnit))
      : "";

  const form = useForm<OperationFormValues, unknown, OperationInput>({
    resolver: zodResolver(validOperationSchema),
    defaultValues: {
      sequence: String(operation?.sequence ?? nextSequence),
      operationTypeId: operation?.type.id ?? "",
      description: operation?.description ?? "",
      resource: initialResource,
      externalCompany: operation?.externalCompany ?? "",
      setupTime: formatDecimal(operation?.setupTimeMin),
      cycleTime: initialCycle,
      cycleUnit: initialUnit,
      notes: operation?.notes ?? "",
    },
  });
  const typeId = useWatch({ control: form.control, name: "operationTypeId" });
  const cycleUnit = useWatch({ control: form.control, name: "cycleUnit" });
  const selectedType = operationTypes.find((type) => type.id === typeId);
  const external = selectedType?.isExternal ?? false;
  const activeTypes = operationTypes.filter(
    (type) => !type.archived || type.id === operation?.type.id,
  );

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const raw = form.getValues();
      // An unchanged (rounded) display value keeps the exact stored seconds.
      const values =
        operation?.cycleTimeS != null &&
        raw.cycleTime === initialCycle &&
        raw.cycleUnit === initialUnit
          ? { ...raw, cycleTime: operation.cycleTimeS, cycleUnit: "s" as const }
          : raw;
      const result = await saveOperationAction(revisionId, operation?.id ?? null, values);
      if (result.ok) {
        const sequence = raw.sequence.trim();
        toast.success(
          operation ? t("updatedToast", { sequence }) : t("createdToast", { sequence }),
        );
        onDone();
        return;
      }
      if (result.error === "sequence_taken") {
        form.setError("sequence", { type: "server", message: t("errors.sequence_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const errorFor = (name: OperationField, error: FormFieldError | undefined) =>
    error?.type === "server" && error.message ? error.message : t(`fieldErrors.${name}`);

  const input = (
    name: "sequence" | "description" | "externalCompany" | "setupTime" | "cycleTime",
    options: { label?: string; hint?: string; decimal?: boolean } = {},
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`operation-${name}`}>{options.label ?? t(name)}</FieldLabel>
          <Input
            {...field}
            id={`operation-${name}`}
            autoComplete="off"
            inputMode={options.decimal ? "decimal" : name === "sequence" ? "numeric" : undefined}
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>{errorFor(name, fieldState.error)}</FieldError>
          ) : options.hint ? (
            <FieldDescription>{options.hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {operation ? t("editTitle", { sequence: operation.sequence }) : t("createTitle")}
        </SheetTitle>
        <SheetDescription>{t("sheetDescription")}</SheetDescription>
      </SheetHeader>
      <form
        id="operation-form"
        onSubmit={onSubmit}
        noValidate
        className="flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          {input("sequence", { hint: t("sequenceHint") })}
          <Controller
            name="operationTypeId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="operation-operationTypeId">{t("operationTypeId")}</FieldLabel>
                <NativeSelect
                  {...field}
                  id="operation-operationTypeId"
                  className="w-full"
                  aria-invalid={fieldState.invalid || undefined}
                >
                  <NativeSelectOption value="">{t("operationTypeNone")}</NativeSelectOption>
                  {activeTypes.map((type) => (
                    <NativeSelectOption key={type.id} value={type.id}>
                      {`${type.code} – ${type.name}`}
                      {type.isExternal ? ` (${t("externalSuffix")})` : ""}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fieldState.invalid ? (
                  <FieldError>{t("fieldErrors.operationTypeId")}</FieldError>
                ) : activeTypes.length === 0 ? (
                  <FieldDescription>{t("noOperationTypes")}</FieldDescription>
                ) : null}
              </Field>
            )}
          />
          {input("description", { hint: t("descriptionHint") })}
          {external ? (
            input("externalCompany", { hint: t("externalCompanyHint") })
          ) : (
            <>
              <Controller
                name="resource"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="operation-resource">{t("resource")}</FieldLabel>
                    <NativeSelect
                      {...field}
                      id="operation-resource"
                      className="w-full"
                      aria-invalid={fieldState.invalid || undefined}
                      onChange={(event) => {
                        field.onChange(event);
                        form.setValue("cycleUnit", unitFor(event.target.value));
                      }}
                    >
                      <NativeSelectOption value="">{t("resourceNone")}</NativeSelectOption>
                      <NativeSelectOptGroup label={t("machinesGroup")}>
                        {machines.map((machine) => (
                          <NativeSelectOption key={machine.id} value={`machine:${machine.id}`}>
                            {`${machine.code} – ${machine.name}`}
                          </NativeSelectOption>
                        ))}
                        {operation?.machine &&
                        !machines.some((m) => m.id === operation.machine?.id) ? (
                          <NativeSelectOption value={`machine:${operation.machine.id}`}>
                            {t("archivedOption", { name: operation.machine.code })}
                          </NativeSelectOption>
                        ) : null}
                      </NativeSelectOptGroup>
                      <NativeSelectOptGroup label={t("machineTypesGroup")}>
                        {machineTypes.map((type) => (
                          <NativeSelectOption key={type.id} value={`type:${type.id}`}>
                            {type.name}
                          </NativeSelectOption>
                        ))}
                        {operation?.machineType &&
                        !machineTypes.some((type) => type.id === operation.machineType?.id) ? (
                          <NativeSelectOption value={`type:${operation.machineType.id}`}>
                            {t("archivedOption", { name: operation.machineType.name })}
                          </NativeSelectOption>
                        ) : null}
                      </NativeSelectOptGroup>
                    </NativeSelect>
                    {fieldState.invalid ? (
                      <FieldError>{t("fieldErrors.resource")}</FieldError>
                    ) : (
                      <FieldDescription>{t("resourceHint")}</FieldDescription>
                    )}
                  </Field>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {input("setupTime", { label: t("setupTime"), decimal: true })}
                {input("cycleTime", {
                  label: t(cycleUnit === "s" ? "cycleTimeSeconds" : "cycleTimeMinutes"),
                  hint: t(cycleUnit === "s" ? "cycleUnitHintSeconds" : "cycleUnitHintMinutes"),
                  decimal: true,
                })}
              </div>
            </>
          )}
          <Controller
            name="notes"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="operation-notes">{t("notes")}</FieldLabel>
                <Textarea
                  {...field}
                  id="operation-notes"
                  rows={3}
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? (
                  <FieldError>{t("fieldErrors.notes")}</FieldError>
                ) : (
                  <FieldDescription>{t("notesHint")}</FieldDescription>
                )}
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="operation-form" disabled={pending}>
          {pending ? t("submitting") : operation ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
