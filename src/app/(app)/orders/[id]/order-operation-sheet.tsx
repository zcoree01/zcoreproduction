"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { formatDecimal } from "@/lib/decimal";
import { addOperationAction, updateOperationAction } from "@/modules/production-orders/actions";
import type { MachineChoice, OrderOperation } from "@/modules/production-orders/queries";
import {
  orderOperationSchema,
  type OrderOperationActionResult,
  type OrderOperationFormValues,
  type OrderOperationInput,
} from "@/modules/production-orders/schemas";
import type { OperationType } from "@/modules/products/queries";
import { resolveCycleUnit, secondsToUnit, type TimeUnit } from "@/modules/products/rules";

type FormError = Extract<OrderOperationActionResult, { ok: false }>["error"];

type Props = {
  orderId: string;
  /** null: add a new operation at the end (draft orders). */
  operation: OrderOperation | null;
  operationTypes: OperationType[];
  machines: MachineChoice[];
  defaultUnit: TimeUnit;
};

export function OrderOperationSheet({
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

function OperationForm({
  orderId,
  operation,
  operationTypes,
  machines,
  defaultUnit,
  onDone,
}: Props & { onDone: () => void }) {
  const t = useTranslations("orders.operationForm");
  const tField = useTranslations("products.operations.form");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();

  const unitFor = (machineId: string): TimeUnit =>
    resolveCycleUnit(
      machines.find((m) => m.id === machineId)?.cycleTimeUnit ??
        operation?.machine?.cycleTimeUnit ??
        null,
      defaultUnit,
    );
  const initialUnit = unitFor(operation?.machine?.id ?? "");
  const initialCycle =
    operation?.cycleTimeS != null
      ? formatDecimal(secondsToUnit(operation.cycleTimeS, initialUnit))
      : "";

  const form = useForm<OrderOperationFormValues, unknown, OrderOperationInput>({
    resolver: zodResolver(orderOperationSchema),
    defaultValues: {
      operationTypeId: operation?.type.id ?? "",
      description: operation?.description ?? "",
      machineId: operation?.machine?.id ?? "",
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
  const external = selectedType?.isExternal ?? operation?.type.isExternal ?? false;
  const activeTypes = operationTypes.filter((type) => !type.archived);

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
      const result = operation
        ? await updateOperationAction(operation.id, values)
        : await addOperationAction(orderId, values);
      if (result.ok) {
        toast.success(operation ? t("updatedToast") : t("createdToast"));
        onDone();
        router.refresh();
        return;
      }
      if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const input = (
    name: "description" | "externalCompany" | "setupTime" | "cycleTime",
    options: { label: string; hint?: string; decimal?: boolean },
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`order-operation-${name}`}>{options.label}</FieldLabel>
          <Input
            {...field}
            id={`order-operation-${name}`}
            autoComplete="off"
            inputMode={options.decimal ? "decimal" : undefined}
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>{tField(`fieldErrors.${name}`)}</FieldError>
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
          {operation
            ? t("editTitle", { code: operation.type.code, name: operation.type.name })
            : t("createTitle")}
        </SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <form
        id="order-operation-form"
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
          {operation ? null : (
            <Controller
              name="operationTypeId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="order-operation-type">
                    {tField("operationTypeId")}
                  </FieldLabel>
                  <NativeSelect
                    {...field}
                    id="order-operation-type"
                    className="w-full"
                    aria-invalid={fieldState.invalid || undefined}
                  >
                    <NativeSelectOption value="">{tField("operationTypeNone")}</NativeSelectOption>
                    {activeTypes.map((type) => (
                      <NativeSelectOption key={type.id} value={type.id}>
                        {`${type.code} – ${type.name}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {fieldState.invalid ? (
                    <FieldError>{tField("fieldErrors.operationTypeId")}</FieldError>
                  ) : null}
                </Field>
              )}
            />
          )}
          {input("description", { label: tField("description") })}
          {external ? (
            input("externalCompany", { label: tField("externalCompany") })
          ) : (
            <>
              {operation ? null : (
                <Controller
                  name="machineId"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="order-operation-machine">{t("machine")}</FieldLabel>
                      <NativeSelect
                        {...field}
                        id="order-operation-machine"
                        className="w-full"
                        onChange={(event) => {
                          field.onChange(event);
                          form.setValue("cycleUnit", unitFor(event.target.value));
                        }}
                      >
                        <NativeSelectOption value="">{t("machineLater")}</NativeSelectOption>
                        {machines.map((machine) => (
                          <NativeSelectOption key={machine.id} value={machine.id}>
                            {`${machine.code} – ${machine.name}`}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {input("setupTime", { label: tField("setupTime"), decimal: true })}
                {input("cycleTime", {
                  label: tField(cycleUnit === "s" ? "cycleTimeSeconds" : "cycleTimeMinutes"),
                  hint: tField(cycleUnit === "s" ? "cycleUnitHintSeconds" : "cycleUnitHintMinutes"),
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
                <FieldLabel htmlFor="order-operation-notes">{tField("notes")}</FieldLabel>
                <Textarea
                  {...field}
                  id="order-operation-notes"
                  rows={3}
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? <FieldError>{tField("fieldErrors.notes")}</FieldError> : null}
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="order-operation-form" disabled={pending}>
          {pending ? t("submitting") : operation ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
