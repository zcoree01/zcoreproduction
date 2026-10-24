"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  Controller,
  useForm,
  type FieldPath,
  type FieldError as FormFieldError,
} from "react-hook-form";
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
import type { CatalogOption } from "@/modules/catalogs/queries";
import { saveMachineAction } from "@/modules/machines/actions";
import type { MachineRow } from "@/modules/machines/queries";
import {
  MACHINE_STATUSES,
  machineSchema,
  type MachineActionResult,
  type MachineFormValues,
  type MachineInput,
} from "@/modules/machines/schemas";

export type MachineCatalogs = { types: CatalogOption[]; locations: CatalogOption[] };

type FormError = Extract<MachineActionResult, { ok: false }>["error"];

const EMPTY: MachineFormValues = {
  code: "",
  name: "",
  typeId: "",
  manufacturer: "",
  model: "",
  locationId: "",
  status: "available",
  notes: "",
};

function toFormValues(machine: MachineRow): MachineFormValues {
  return {
    code: machine.code,
    name: machine.name,
    typeId: machine.type?.id ?? "",
    manufacturer: machine.manufacturer ?? "",
    model: machine.model ?? "",
    locationId: machine.location?.id ?? "",
    status: machine.status,
    notes: machine.notes ?? "",
  };
}

/** Catalog options plus the current value when it has been archived meanwhile. */
function withCurrent(options: CatalogOption[], current: { id: string; name: string } | null) {
  return current && !options.some((option) => option.id === current.id)
    ? [...options, { ...current, archived: true }]
    : options;
}

export function CreateMachineButton({ catalogs }: { catalogs: MachineCatalogs }) {
  const t = useTranslations("machines.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("open")}
      </Button>
      <MachineSheet open={open} onOpenChange={setOpen} machine={null} catalogs={catalogs} />
    </>
  );
}

/** Create (machine null) or edit form in a side sheet. */
export function MachineSheet({
  open,
  onOpenChange,
  machine,
  catalogs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machine: MachineRow | null;
  catalogs: MachineCatalogs;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        {/* Keyed so the form resets to the selected machine every time it opens. */}
        {open ? (
          <MachineForm
            key={machine?.id ?? "new"}
            machine={machine}
            catalogs={catalogs}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function MachineForm({
  machine,
  catalogs,
  onDone,
}: {
  machine: MachineRow | null;
  catalogs: MachineCatalogs;
  onDone: () => void;
}) {
  const t = useTranslations("machines.form");
  const tStatus = useTranslations("machineStatus");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<MachineFormValues, unknown, MachineInput>({
    resolver: zodResolver(machineSchema),
    defaultValues: machine ? toFormValues(machine) : EMPTY,
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      // Raw form values: the server action validates them with the same schema.
      const result = await saveMachineAction(machine?.id ?? null, form.getValues());
      if (result.ok) {
        const code = values.code;
        toast.success(machine ? t("updatedToast", { code }) : t("createdToast", { code }));
        onDone();
        return;
      }
      if (result.error === "code_taken") {
        form.setError("code", { type: "server", message: t("errors.code_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const errorFor = (name: FieldPath<MachineFormValues>, error: FormFieldError | undefined) =>
    error?.type === "server" && error.message ? error.message : t(`fieldErrors.${name}`);

  const textField = (
    name: "code" | "name" | "manufacturer" | "model",
    options: { hint?: string } = {},
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`machine-${name}`}>{t(name)}</FieldLabel>
          <Input
            {...field}
            id={`machine-${name}`}
            autoComplete="off"
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

  const catalogField = (
    name: "typeId" | "locationId",
    label: string,
    none: string,
    options: (CatalogOption & { archived?: boolean })[],
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`machine-${name}`}>{label}</FieldLabel>
          <NativeSelect
            {...field}
            id={`machine-${name}`}
            className="w-full"
            aria-invalid={fieldState.invalid || undefined}
          >
            <NativeSelectOption value="">{none}</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.archived ? t("archivedOption", { name: option.name }) : option.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {fieldState.invalid ? <FieldError>{t(`fieldErrors.${name}`)}</FieldError> : null}
        </Field>
      )}
    />
  );

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {machine ? t("editTitle", { code: machine.code }) : t("createTitle")}
        </SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <form id="machine-form" onSubmit={onSubmit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          {textField("code", { hint: t("codeHint") })}
          {textField("name")}
          {catalogField(
            "typeId",
            t("type"),
            t("typeNone"),
            withCurrent(catalogs.types, machine?.type ?? null),
          )}
          {textField("manufacturer")}
          {textField("model")}
          {catalogField(
            "locationId",
            t("location"),
            t("locationNone"),
            withCurrent(catalogs.locations, machine?.location ?? null),
          )}
          <Controller
            name="status"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="machine-status">{t("status")}</FieldLabel>
                <NativeSelect
                  {...field}
                  id="machine-status"
                  className="w-full"
                  aria-invalid={fieldState.invalid || undefined}
                >
                  {MACHINE_STATUSES.map((status) => (
                    <NativeSelectOption key={status} value={status}>
                      {tStatus(status)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fieldState.invalid ? <FieldError>{t("fieldErrors.status")}</FieldError> : null}
              </Field>
            )}
          />
          <Controller
            name="notes"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="machine-notes">{t("notes")}</FieldLabel>
                <Textarea
                  {...field}
                  id="machine-notes"
                  rows={3}
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? <FieldError>{t("fieldErrors.notes")}</FieldError> : null}
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="machine-form" disabled={pending}>
          {pending ? t("submitting") : machine ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
