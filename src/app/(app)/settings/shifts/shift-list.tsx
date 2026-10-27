"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArchiveIcon,
  ClockIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  saveShiftAction,
  setShiftArchivedAction,
  type ShiftActionResult,
} from "@/modules/attendance/actions";
import type { ShiftRow } from "@/modules/attendance/queries";
import {
  crossesMidnight,
  endExtendedForBreaks,
  formatMinutes,
  shiftLengthMinutes,
  shiftWorkMinutes,
  type ShiftBreakDef,
} from "@/modules/attendance/rules";
import {
  shiftSchema,
  timeOfDay,
  type ShiftFormValues,
  type ShiftInput,
} from "@/modules/attendance/schemas";

type FormError = Extract<ShiftActionResult, { ok: false }>["error"];

export function ShiftList({ items }: { items: ShiftRow[] }) {
  const t = useTranslations("shifts");
  const [editing, setEditing] = useState<ShiftRow | "new" | null>(null);
  const [archiving, setArchiving] = useState<ShiftRow | null>(null);
  const [, startTransition] = useTransition();

  const breakSummary = (row: ShiftRow) =>
    row.breaks.length === 0
      ? t("noBreaks")
      : row.breaks
          .map((part) =>
            t(part.paid ? "breakPaid" : "breakUnpaid", {
              minutes: part.minutes,
              at: part.startsAt ?? "",
              fixed: part.startsAt ? "yes" : "no",
            }),
          )
          .join(", ");

  const restore = (item: ShiftRow) =>
    startTransition(async () => {
      const result = await setShiftArchivedAction(item.id, false);
      if (result.ok) toast.success(t("restoredToast", { name: item.name }));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("listTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("listDescription")}</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          {t("add")}
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<ClockIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("columns.code")}</TableHead>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.time")}</TableHead>
                <TableHead className="text-right">{t("columns.length")}</TableHead>
                <TableHead>{t("columns.breaks")}</TableHead>
                <TableHead className="text-right">{t("columns.work")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const archived = item.archivedAt !== null;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="font-mono"
                        style={
                          item.color ? { borderColor: item.color, color: item.color } : undefined
                        }
                      >
                        {item.code}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="tabular-nums">
                      <span className="flex items-center gap-1">
                        {item.startsAt}–{item.endsAt}
                        {crossesMidnight(item.startsAt, item.endsAt) ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MoonIcon className="size-3" aria-hidden />
                            {t("nextDay")}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(shiftLengthMinutes(item.startsAt, item.endsAt))}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {breakSummary(item)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMinutes(shiftWorkMinutes(item.startsAt, item.endsAt, item.breaks))}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={archived ? "neutral" : "success"}>
                        {archived ? t("status.archived") : t("status.active")}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {archived ? (
                          <Button variant="ghost" size="sm" onClick={() => restore(item)}>
                            <RotateCcwIcon />
                            {t("restore")}
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("edit", { name: item.name })}
                              onClick={() => setEditing(item)}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("archive", { name: item.name })}
                              onClick={() => setArchiving(item)}
                            >
                              <ArchiveIcon />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
          {editing !== null ? (
            <ShiftForm
              key={editing === "new" ? "new" : editing.id}
              item={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t("archiveTitle", { name: archiving?.name ?? "" })}
        description={t("archiveDescription")}
        confirmLabel={t("archiveConfirm")}
        destructive
        onConfirm={async () => {
          if (!archiving) return;
          const result = await setShiftArchivedAction(archiving.id, true);
          if (result.ok) toast.success(t("archivedToast", { name: archiving.name }));
          else toast.error(t(`errors.${result.error}`));
        }}
      />
    </section>
  );
}

/** Breaks as entered, for the live totals (invalid rows count as nothing). */
function liveBreaks(values: ShiftFormValues["breaks"] | undefined): ShiftBreakDef[] {
  return (values ?? []).flatMap((item) => {
    const minutes = Number(item.minutes);
    if (!Number.isInteger(minutes) || minutes < 1) return [];
    return [{ startsAt: item.startsAt || null, minutes, paid: item.paid }];
  });
}

function ShiftForm({ item, onDone }: { item: ShiftRow | null; onDone: () => void }) {
  const t = useTranslations("shifts");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ShiftFormValues, unknown, ShiftInput>({
    resolver: zodResolver(shiftSchema),
    defaultValues: item
      ? {
          name: item.name,
          code: item.code,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          color: item.color ?? "",
          breaks: item.breaks.map((row) => ({
            name: row.name ?? "",
            startsAt: row.startsAt ?? "",
            minutes: String(row.minutes),
            paid: row.paid,
          })),
        }
      : {
          name: "",
          code: "",
          startsAt: "06:00",
          endsAt: "14:00",
          color: "",
          breaks: [{ name: "", startsAt: "", minutes: "30", paid: true }],
        },
  });
  const breaks = useFieldArray({ control: form.control, name: "breaks" });
  const [startsAt, endsAt, breakValues] = useWatch({
    control: form.control,
    name: ["startsAt", "endsAt", "breaks"],
  });
  const timesValid = timeOfDay.safeParse(startsAt).success && timeOfDay.safeParse(endsAt).success;
  const current = liveBreaks(breakValues);
  const unpaid = current.filter((row) => !row.paid).reduce((sum, row) => sum + row.minutes, 0);
  const length = timesValid && startsAt !== endsAt ? shiftLengthMinutes(startsAt, endsAt) : null;
  const work = length !== null ? shiftWorkMinutes(startsAt, endsAt, current) : null;
  // Unpaid breaks cut the working time below whole hours (e.g. 7:30): offer to
  // move the end so the shift keeps whole hours of work (8:00 → ends 14:30).
  const targetWork =
    work !== null && unpaid > 0 && work % 60 !== 0 ? Math.ceil(work / 60) * 60 : null;
  const extendedEnd =
    targetWork !== null ? endExtendedForBreaks(startsAt, targetWork, current) : null;

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await saveShiftAction(item?.id ?? null, values);
      if (result.ok) {
        toast.success(t(item ? "updatedToast" : "createdToast", { name: values.name.trim() }));
        onDone();
        return;
      }
      if (result.error === "duplicate_name" || result.error === "duplicate_code") {
        form.setError(result.error === "duplicate_name" ? "name" : "code", {
          type: "server",
          message: t(`errors.${result.error}`),
        });
      } else if (
        result.error === "breaks_too_long" ||
        result.error === "break_outside_shift" ||
        result.error === "invalid_shift_times"
      ) {
        setFormError(result.error);
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const { errors } = useFormState({ control: form.control });
  const breaksError = errors.breaks;
  const breaksMessage =
    breaksError?.message === "breaks_too_long" || breaksError?.message === "break_outside_shift"
      ? t(`errors.${breaksError.message}`)
      : breaksError
        ? t("fieldErrors.breaks")
        : null;

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{item ? t("editTitle", { name: item.name }) : t("createTitle")}</SheetTitle>
        <SheetDescription>{t("formDescription")}</SheetDescription>
      </SheetHeader>
      <form id="shift-form" onSubmit={onSubmit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            {(["name", "code"] as const).map((name) => (
              <Controller
                key={name}
                name={name}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor={`shift-${name}`}>{t(`fields.${name}`)}</FieldLabel>
                    <Input
                      {...field}
                      id={`shift-${name}`}
                      autoComplete="off"
                      className={name === "code" ? "font-mono uppercase" : undefined}
                      aria-invalid={fieldState.invalid || undefined}
                    />
                    {fieldState.invalid ? (
                      <FieldError>
                        {fieldState.error?.type === "server" && fieldState.error.message
                          ? fieldState.error.message
                          : t(`fieldErrors.${name}`)}
                      </FieldError>
                    ) : null}
                  </Field>
                )}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(["startsAt", "endsAt"] as const).map((name) => (
              <Controller
                key={name}
                name={name}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor={`shift-${name}`}>{t(`fields.${name}`)}</FieldLabel>
                    <Input
                      {...field}
                      id={`shift-${name}`}
                      type="time"
                      className="tabular-nums"
                      aria-invalid={fieldState.invalid || undefined}
                    />
                    {fieldState.invalid ? (
                      <FieldError>{t(`fieldErrors.${name}`)}</FieldError>
                    ) : null}
                  </Field>
                )}
              />
            ))}
          </div>
          {length !== null ? (
            <p className="text-sm text-muted-foreground">
              {t("lengthSummary", {
                length: formatMinutes(length),
                work: formatMinutes(work ?? 0),
                nextDay: crossesMidnight(startsAt, endsAt) ? "yes" : "no",
              })}
            </p>
          ) : null}

          <FieldSet>
            <FieldLegend>{t("breaksTitle")}</FieldLegend>
            <FieldDescription>{t("breaksDescription")}</FieldDescription>
            {breaks.fields.map((row, index) => (
              <div key={row.id} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="grid grid-cols-[1fr_7rem_6rem] gap-2">
                  <Controller
                    name={`breaks.${index}.name`}
                    control={form.control}
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor={`break-${index}-name`}>
                          {t("fields.breakName")}
                        </FieldLabel>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          id={`break-${index}-name`}
                          placeholder={t("breakNamePlaceholder")}
                        />
                      </Field>
                    )}
                  />
                  <Controller
                    name={`breaks.${index}.startsAt`}
                    control={form.control}
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor={`break-${index}-startsAt`}>
                          {t("fields.breakStartsAt")}
                        </FieldLabel>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          id={`break-${index}-startsAt`}
                          type="time"
                        />
                      </Field>
                    )}
                  />
                  <Controller
                    name={`breaks.${index}.minutes`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid || undefined}>
                        <FieldLabel htmlFor={`break-${index}-minutes`}>
                          {t("fields.breakMinutes")}
                        </FieldLabel>
                        <Input
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          value={String(field.value ?? "")}
                          onChange={(event) => field.onChange(event.target.value)}
                          id={`break-${index}-minutes`}
                          inputMode="numeric"
                          aria-invalid={fieldState.invalid || undefined}
                        />
                      </Field>
                    )}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Controller
                    name={`breaks.${index}.paid`}
                    control={form.control}
                    render={({ field }) => (
                      <Field orientation="horizontal">
                        <Checkbox
                          id={`break-${index}-paid`}
                          checked={field.value}
                          onCheckedChange={(value) => field.onChange(value === true)}
                        />
                        <FieldLabel htmlFor={`break-${index}-paid`}>{t("fields.paid")}</FieldLabel>
                      </Field>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => breaks.remove(index)}
                  >
                    <Trash2Icon />
                    {t("removeBreak")}
                  </Button>
                </div>
              </div>
            ))}
            {breaksMessage ? <FieldError>{breaksMessage}</FieldError> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  breaks.append({ name: "", startsAt: "", minutes: "30", paid: false })
                }
              >
                <PlusIcon />
                {t("addBreak")}
              </Button>
            </div>
            {extendedEnd !== null ? (
              <Alert>
                <AlertDescription className="flex flex-col gap-2">
                  <span>
                    {t("extendQuestion", {
                      unpaid,
                      work: formatMinutes(work ?? 0),
                      target: formatMinutes(targetWork ?? 0),
                      end: extendedEnd,
                    })}
                  </span>
                  <span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        form.setValue("endsAt", extendedEnd, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      {t("extendButton", { end: extendedEnd })}
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldSet>

          <Controller
            name="color"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="shift-color">{t("fields.color")}</FieldLabel>
                <div className="flex items-center gap-2">
                  <input
                    id="shift-color"
                    type="color"
                    className="h-9 w-12 cursor-pointer rounded-md border bg-transparent"
                    value={field.value || "#64748b"}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                  {field.value ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => field.onChange("")}
                    >
                      {t("clearColor")}
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("noColor")}</span>
                  )}
                </div>
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="shift-form" disabled={pending}>
          {pending ? t("submitting") : item ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
