"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArchiveIcon, PencilIcon, PlusIcon, RepeatIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  saveRotationAction,
  setRotationArchivedAction,
  type RotationActionResult,
} from "@/modules/attendance/schedule-actions";
import type { Rotation } from "@/modules/attendance/schedule-queries";
import {
  MAX_CYCLE_DAYS,
  rotationSchema,
  type RotationFormValues,
  type RotationInput,
} from "@/modules/attendance/schedule-schemas";

type ShiftOption = { id: string; code: string; name: string; color: string | null };
type FormError = Extract<RotationActionResult, { ok: false }>["error"];

function Pattern({ days, shifts }: { days: (string | null)[]; shifts: Map<string, ShiftOption> }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {days.map((id, index) => {
        const shift = id ? shifts.get(id) : undefined;
        return (
          <span
            key={index}
            className="flex h-6 min-w-7 items-center justify-center rounded border px-0.5 font-mono text-[11px]"
            style={
              shift?.color
                ? {
                    borderColor: shift.color,
                    color: shift.color,
                    backgroundColor: `${shift.color}22`,
                  }
                : undefined
            }
          >
            {shift ? shift.code : "–"}
          </span>
        );
      })}
    </div>
  );
}

export function RotationsPanel({
  rotations,
  shifts,
  canManage,
}: {
  rotations: Rotation[];
  shifts: ShiftOption[];
  canManage: boolean;
}) {
  const t = useTranslations("crews");
  const [editing, setEditing] = useState<Rotation | "new" | null>(null);
  const [archiving, setArchiving] = useState<Rotation | null>(null);
  const [, startTransition] = useTransition();
  const byId = new Map(shifts.map((shift) => [shift.id, shift]));

  const restore = (rotation: Rotation) =>
    startTransition(async () => {
      const result = await setRotationArchivedAction(rotation.id, false);
      if (result.ok) toast.success(t("rotationRestoredToast", { name: rotation.name }));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("rotationsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("rotationsDescription")}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setEditing("new")} disabled={shifts.length === 0}>
            <PlusIcon />
            {t("addRotation")}
          </Button>
        ) : null}
      </div>
      {rotations.length === 0 ? (
        <EmptyState
          icon={<RepeatIcon />}
          title={t("rotationsEmptyTitle")}
          description={t("rotationsEmptyDescription")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rotations.map((rotation) => (
            <li
              key={rotation.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-48 flex-col gap-1">
                <span className="font-medium">{rotation.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("cycleLength", { days: rotation.cycleDays })}
                  {rotation.archived ? (
                    <StatusBadge tone="neutral">{t("status.archived")}</StatusBadge>
                  ) : null}
                </span>
              </div>
              <div className="flex-1">
                <Pattern days={rotation.days} shifts={byId} />
              </div>
              {canManage ? (
                <div className="flex justify-end gap-1">
                  {rotation.archived ? (
                    <Button variant="ghost" size="sm" onClick={() => restore(rotation)}>
                      <RotateCcwIcon />
                      {t("restore")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("editRotation", { name: rotation.name })}
                        onClick={() => setEditing(rotation)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("archiveRotation", { name: rotation.name })}
                        onClick={() => setArchiving(rotation)}
                      >
                        <ArchiveIcon />
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-xl">
          {editing !== null ? (
            <RotationForm
              key={editing === "new" ? "new" : editing.id}
              rotation={editing === "new" ? null : editing}
              shifts={shifts}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t("archiveRotationTitle", { name: archiving?.name ?? "" })}
        description={t("archiveRotationDescription")}
        confirmLabel={t("archiveConfirm")}
        destructive
        onConfirm={async () => {
          if (!archiving) return;
          const result = await setRotationArchivedAction(archiving.id, true);
          if (result.ok) toast.success(t("rotationArchivedToast", { name: archiving.name }));
          else toast.error(t(`errors.${result.error}`));
        }}
      />
    </section>
  );
}

function RotationForm({
  rotation,
  shifts,
  onDone,
}: {
  rotation: Rotation | null;
  shifts: ShiftOption[];
  onDone: () => void;
}) {
  const t = useTranslations("crews");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<RotationFormValues, unknown, RotationInput>({
    resolver: zodResolver(rotationSchema),
    defaultValues: rotation
      ? {
          name: rotation.name,
          cycleDays: String(rotation.cycleDays),
          days: rotation.days.map((id) => id ?? ""),
        }
      : { name: "", cycleDays: "7", days: ["", "", "", "", "", "", ""] },
  });
  const days = useWatch({ control: form.control, name: "days" });

  const resize = (value: string) => {
    form.setValue("cycleDays", value, { shouldDirty: true });
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > MAX_CYCLE_DAYS) return;
    const current = form.getValues("days");
    form.setValue(
      "days",
      Array.from({ length: count }, (_, index) => current[index] ?? ""),
      { shouldDirty: true },
    );
  };

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await saveRotationAction(rotation?.id ?? null, values);
      if (result.ok) {
        toast.success(
          t(rotation ? "rotationUpdatedToast" : "rotationCreatedToast", {
            name: values.name.trim(),
          }),
        );
        onDone();
        return;
      }
      if (result.error === "duplicate_name") {
        form.setError("name", { type: "server", message: t("errors.duplicate_name") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const { errors } = useFormState({ control: form.control });
  const daysError = errors.days;

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {rotation ? t("editRotationTitle", { name: rotation.name }) : t("createRotationTitle")}
        </SheetTitle>
        <SheetDescription>{t("rotationFormDescription")}</SheetDescription>
      </SheetHeader>
      <form
        id="rotation-form"
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
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="rotation-name">{t("fields.name")}</FieldLabel>
                  <Input
                    {...field}
                    id="rotation-name"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid || undefined}
                  />
                  {fieldState.invalid ? (
                    <FieldError>
                      {fieldState.error?.type === "server" && fieldState.error.message
                        ? fieldState.error.message
                        : t("fieldErrors.name")}
                    </FieldError>
                  ) : null}
                </Field>
              )}
            />
            <Controller
              name="cycleDays"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="rotation-cycle">{t("fields.cycleDays")}</FieldLabel>
                  <Input
                    id="rotation-cycle"
                    inputMode="numeric"
                    value={String(field.value ?? "")}
                    onChange={(event) => resize(event.target.value)}
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid || undefined}
                  />
                  {fieldState.invalid ? (
                    <FieldError>{t("fieldErrors.cycleDays")}</FieldError>
                  ) : null}
                </Field>
              )}
            />
          </div>
          <Field data-invalid={daysError ? true : undefined}>
            <FieldLabel>{t("fields.days")}</FieldLabel>
            <FieldDescription>{t("daysHint")}</FieldDescription>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {days.map((value, index) => (
                <label key={index} className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("dayNumber", { day: index + 1 })}
                  <NativeSelect
                    value={value}
                    aria-label={t("dayNumber", { day: index + 1 })}
                    onChange={(event) => {
                      const next = [...form.getValues("days")];
                      next[index] = event.target.value;
                      form.setValue("days", next, {
                        shouldDirty: true,
                        shouldValidate: form.formState.isSubmitted,
                      });
                    }}
                  >
                    <NativeSelectOption value="">{t("dayOff")}</NativeSelectOption>
                    {shifts.map((shift) => (
                      <NativeSelectOption key={shift.id} value={shift.id}>
                        {shift.code} · {shift.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              ))}
            </div>
            {daysError ? <FieldError>{t("fieldErrors.days")}</FieldError> : null}
          </Field>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {days.map((value, index) => {
              const shift = shifts.find((item) => item.id === value);
              return (
                <Badge key={index} variant="outline" className="font-mono">
                  {shift ? shift.code : "–"}
                </Badge>
              );
            })}
          </div>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="rotation-form" disabled={pending}>
          {pending ? t("submitting") : rotation ? t("submitEdit") : t("submitCreateRotation")}
        </Button>
      </SheetFooter>
    </>
  );
}
