"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClockIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/format";
import {
  assignRotationAction,
  endAssignmentAction,
  type AssignmentActionResult,
} from "@/modules/attendance/schedule-actions";
import type {
  Crew,
  Rotation,
  RotationAssignment,
  ScheduleEmployee,
} from "@/modules/attendance/schedule-queries";
import { addDays, daysBetween } from "@/modules/attendance/schedule-rules";
import {
  assignmentSchema,
  type AssignmentFormValues,
  type AssignmentInput,
} from "@/modules/attendance/schedule-schemas";

type FormError = Extract<AssignmentActionResult, { ok: false }>["error"];

export function AssignmentsPanel({
  assignments,
  rotations,
  allRotations,
  crews,
  employees,
  canManage,
  today,
}: {
  assignments: RotationAssignment[];
  rotations: Rotation[];
  allRotations: Rotation[];
  crews: Crew[];
  employees: ScheduleEmployee[];
  canManage: boolean;
  today: string;
}) {
  const t = useTranslations("crews");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rotationName = new Map(allRotations.map((rotation) => [rotation.id, rotation.name]));
  const crewName = new Map(crews.map((crew) => [crew.id, crew.name]));
  const employeeName = new Map(employees.map((employee) => [employee.id, employee.name]));

  const end = (assignment: RotationAssignment) =>
    startTransition(async () => {
      // Ends today (or, when it has not started yet, removes it).
      const endDate =
        daysBetween(assignment.startDate, today) >= 0 ? today : addDays(assignment.startDate, -1);
      let result: Awaited<ReturnType<typeof endAssignmentAction>>;
      try {
        result = await endAssignmentAction(assignment.id, endDate);
      } catch {
        toast.error(t("errors.offline"));
        return;
      }
      if (result.ok) toast.success(t("assignmentEndedToast"));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("assignmentsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("assignmentsDescription")}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setOpen(true)} disabled={rotations.length === 0}>
            <PlusIcon />
            {t("addAssignment")}
          </Button>
        ) : null}
      </div>
      {assignments.length === 0 ? (
        <EmptyState
          icon={<CalendarClockIcon />}
          title={t("assignmentsEmptyTitle")}
          description={t("assignmentsEmptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.rotation")}</TableHead>
                <TableHead>{t("columns.who")}</TableHead>
                <TableHead>{t("columns.from")}</TableHead>
                <TableHead>{t("columns.to")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => {
                const ended =
                  assignment.endDate !== null && daysBetween(assignment.endDate, today) > 0;
                return (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-medium">
                      {rotationName.get(assignment.rotationId) ?? "—"}
                    </TableCell>
                    <TableCell>
                      {assignment.crewId
                        ? t("crewLabel", { name: crewName.get(assignment.crewId) ?? "—" })
                        : (employeeName.get(assignment.employeeId ?? "") ?? "—")}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDay(assignment.startDate)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {assignment.endDate ? formatDay(assignment.endDate) : t("openEnded")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={ended ? "neutral" : "success"}>
                        {ended ? t("status.ended") : t("status.active")}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {canManage && !ended ? (
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => end(assignment)}
                          >
                            <SquareIcon />
                            {t("endAssignment")}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {open ? (
            <AssignmentForm
              rotations={rotations}
              crews={crews.filter((crew) => !crew.archived)}
              employees={employees}
              today={today}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function AssignmentForm({
  rotations,
  crews,
  employees,
  today,
  onDone,
}: {
  rotations: Rotation[];
  crews: Crew[];
  employees: ScheduleEmployee[];
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("crews");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<AssignmentFormValues, unknown, AssignmentInput>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: {
      rotationId: rotations[0]?.id ?? "",
      target: crews.length > 0 ? "crew" : "employee",
      targetId: "",
      startDate: today,
      endDate: "",
    },
  });
  const target = useWatch({ control: form.control, name: "target" });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const result = await assignRotationAction(form.getValues());
      if (result.ok) {
        toast.success(t("assignedToast"));
        onDone();
        return;
      }
      if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("assignTitle")}</SheetTitle>
        <SheetDescription>{t("assignDescription")}</SheetDescription>
      </SheetHeader>
      <form
        id="assignment-form"
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
          <Controller
            name="rotationId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="assignment-rotation">{t("fields.rotation")}</FieldLabel>
                <NativeSelect id="assignment-rotation" className="w-full" {...field}>
                  {rotations.map((rotation) => (
                    <NativeSelectOption key={rotation.id} value={rotation.id}>
                      {rotation.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          />
          <Controller
            name="target"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="assignment-target">{t("fields.target")}</FieldLabel>
                <NativeSelect
                  id="assignment-target"
                  className="w-full"
                  value={field.value}
                  onChange={(event) => {
                    field.onChange(event.target.value === "crew" ? "crew" : "employee");
                    form.setValue("targetId", "");
                  }}
                >
                  <NativeSelectOption value="crew" disabled={crews.length === 0}>
                    {t("targetCrew")}
                  </NativeSelectOption>
                  <NativeSelectOption value="employee">{t("targetEmployee")}</NativeSelectOption>
                </NativeSelect>
              </Field>
            )}
          />
          <Controller
            name="targetId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="assignment-target-id">
                  {target === "crew" ? t("fields.crew") : t("fields.employee")}
                </FieldLabel>
                <NativeSelect
                  id="assignment-target-id"
                  className="w-full"
                  {...field}
                  aria-invalid={fieldState.invalid || undefined}
                >
                  <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
                  {(target === "crew" ? crews : employees).map((item) => (
                    <NativeSelectOption key={item.id} value={item.id}>
                      {item.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fieldState.invalid ? <FieldError>{t("fieldErrors.targetId")}</FieldError> : null}
              </Field>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            {(["startDate", "endDate"] as const).map((name) => (
              <Controller
                key={name}
                name={name}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor={`assignment-${name}`}>{t(`fields.${name}`)}</FieldLabel>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      id={`assignment-${name}`}
                      type="date"
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
          <FieldDescription>{t("startHint")}</FieldDescription>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="assignment-form" disabled={pending}>
          {pending ? t("submitting") : t("submitAssign")}
        </Button>
      </SheetFooter>
    </>
  );
}
