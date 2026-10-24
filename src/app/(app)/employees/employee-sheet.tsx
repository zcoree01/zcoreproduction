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
import type { CatalogOption } from "@/modules/catalogs/queries";
import { saveEmployeeAction } from "@/modules/employees/actions";
import type { EmployeeRow, LinkableUser } from "@/modules/employees/queries";
import {
  EMPLOYEE_STATUSES,
  employeeSchema,
  SKILL_LEVELS,
  skillLevelSchema,
  type EmployeeActionResult,
  type EmployeeFormValues,
  type EmployeeInput,
} from "@/modules/employees/schemas";
import type { MachineOption } from "@/modules/machines/queries";

export type EmployeeFormOptions = {
  departments: CatalogOption[];
  jobTitles: CatalogOption[];
  skills: CatalogOption[];
  machines: MachineOption[];
  users: LinkableUser[];
};

type FormError = Extract<EmployeeActionResult, { ok: false }>["error"];
type Option = { id: string; label: string; archived?: boolean };

const EMPTY: EmployeeFormValues = {
  employeeNumber: "",
  firstName: "",
  lastName: "",
  departmentId: "",
  jobTitleId: "",
  userId: "",
  status: "active",
  skills: [],
  machineIds: [],
};

function toFormValues(employee: EmployeeRow): EmployeeFormValues {
  return {
    employeeNumber: String(employee.employeeNumber),
    firstName: employee.firstName,
    lastName: employee.lastName,
    departmentId: employee.department?.id ?? "",
    jobTitleId: employee.jobTitle?.id ?? "",
    userId: employee.user?.id ?? "",
    status: employee.status,
    skills: employee.skills.map((skill) => ({ skillId: skill.skillId, level: skill.level })),
    machineIds: employee.machines.map((machine) => machine.machineId),
  };
}

/** Active options plus values the employee still uses that were archived meanwhile. */
function withCurrent(active: Option[], current: Option[]): Option[] {
  const known = new Set(active.map((option) => option.id));
  return [
    ...active,
    ...current
      .filter((option) => !known.has(option.id))
      .map((option) => ({ ...option, archived: true })),
  ];
}

const catalogOptions = (items: CatalogOption[]): Option[] =>
  items.map((item) => ({ id: item.id, label: item.name }));

export function CreateEmployeeButton({ options }: { options: EmployeeFormOptions }) {
  const t = useTranslations("employees.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("open")}
      </Button>
      <EmployeeSheet open={open} onOpenChange={setOpen} employee={null} options={options} />
    </>
  );
}

/** Create (employee null) or edit form in a side sheet. */
export function EmployeeSheet({
  open,
  onOpenChange,
  employee,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeRow | null;
  options: EmployeeFormOptions;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
        {/* Keyed so the form resets to the selected employee every time it opens. */}
        {open ? (
          <EmployeeForm
            key={employee?.id ?? "new"}
            employee={employee}
            options={options}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EmployeeForm({
  employee,
  options,
  onDone,
}: {
  employee: EmployeeRow | null;
  options: EmployeeFormOptions;
  onDone: () => void;
}) {
  const t = useTranslations("employees.form");
  const tStatus = useTranslations("employeeStatus");
  const tLevel = useTranslations("skillLevels");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<EmployeeFormValues, unknown, EmployeeInput>({
    resolver: zodResolver(employeeSchema),
    defaultValues: employee ? toFormValues(employee) : EMPTY,
  });

  const departments = withCurrent(
    catalogOptions(options.departments),
    employee?.department ? [{ id: employee.department.id, label: employee.department.name }] : [],
  );
  const jobTitles = withCurrent(
    catalogOptions(options.jobTitles),
    employee?.jobTitle ? [{ id: employee.jobTitle.id, label: employee.jobTitle.name }] : [],
  );
  const skills = withCurrent(
    catalogOptions(options.skills),
    (employee?.skills ?? []).map((skill) => ({ id: skill.skillId, label: skill.name })),
  );
  const machines = withCurrent(
    options.machines.map((m) => ({ id: m.id, label: `${m.code} · ${m.name}` })),
    (employee?.machines ?? []).map((m) => ({ id: m.machineId, label: `${m.code} · ${m.name}` })),
  );
  // Accounts not used by another current employee (+ this employee's own).
  const users = withCurrent(
    options.users
      .filter((user) => user.employeeId === null || user.employeeId === employee?.id)
      .map((user) => ({
        id: user.userId,
        label: user.fullName ? `${user.username} (${user.fullName})` : user.username,
      })),
    employee?.user ? [{ id: employee.user.id, label: employee.user.username }] : [],
  );

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      // Raw form values: the server action validates them with the same schema.
      const result = await saveEmployeeAction(employee?.id ?? null, form.getValues());
      if (result.ok) {
        const name = `${values.firstName} ${values.lastName}`;
        toast.success(employee ? t("updatedToast", { name }) : t("createdToast", { name }));
        onDone();
        return;
      }
      if (result.error === "number_taken") {
        form.setError("employeeNumber", { type: "server", message: t("errors.number_taken") });
      } else if (result.error === "user_taken") {
        form.setError("userId", { type: "server", message: t("errors.user_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const errorFor = (name: FieldPath<EmployeeFormValues>, error: FormFieldError | undefined) =>
    error?.type === "server" && error.message
      ? error.message
      : t(`fieldErrors.${name as keyof typeof EMPTY}`);

  const textField = (
    name: "employeeNumber" | "firstName" | "lastName",
    options: { hint?: string; inputMode?: "numeric" } = {},
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`employee-${name}`}>{t(name)}</FieldLabel>
          <Input
            {...field}
            id={`employee-${name}`}
            autoComplete="off"
            inputMode={options.inputMode}
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

  const selectField = (
    name: "departmentId" | "jobTitleId" | "userId",
    label: string,
    none: string,
    items: Option[],
    hint?: string,
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`employee-${name}`}>{label}</FieldLabel>
          <NativeSelect
            {...field}
            id={`employee-${name}`}
            className="w-full"
            aria-invalid={fieldState.invalid || undefined}
          >
            <NativeSelectOption value="">{none}</NativeSelectOption>
            {items.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.archived ? t("archivedOption", { name: item.label }) : item.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {fieldState.invalid ? (
            <FieldError>{errorFor(name, fieldState.error)}</FieldError>
          ) : hint ? (
            <FieldDescription>{hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {employee
            ? t("editTitle", { name: `${employee.firstName} ${employee.lastName}` })
            : t("createTitle")}
        </SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <form
        id="employee-form"
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
          {textField("employeeNumber", {
            inputMode: "numeric",
            hint: employee ? t("employeeNumberEditHint") : t("employeeNumberHint"),
          })}
          <div className="grid gap-4 sm:grid-cols-2">
            {textField("firstName")}
            {textField("lastName")}
          </div>
          {selectField("departmentId", t("department"), t("departmentNone"), departments)}
          {selectField("jobTitleId", t("jobTitle"), t("jobTitleNone"), jobTitles)}
          {selectField("userId", t("user"), t("userNone"), users, t("userHint"))}
          <Controller
            name="status"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="employee-status">{t("status")}</FieldLabel>
                <NativeSelect {...field} id="employee-status" className="w-full">
                  {EMPLOYEE_STATUSES.map((status) => (
                    <NativeSelectOption key={status} value={status}>
                      {tStatus(status)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          />

          <Controller
            name="skills"
            control={form.control}
            render={({ field, fieldState }) => {
              const levelOf = new Map(field.value.map((skill) => [skill.skillId, skill.level]));
              const setLevel = (skillId: string, raw: string) => {
                const rest = field.value.filter((skill) => skill.skillId !== skillId);
                const level = skillLevelSchema.safeParse(Number(raw));
                field.onChange(level.success ? [...rest, { skillId, level: level.data }] : rest);
              };
              return (
                <FieldSet data-invalid={fieldState.invalid || undefined}>
                  <FieldLegend variant="label">{t("skills")}</FieldLegend>
                  {skills.length === 0 ? (
                    <FieldDescription>{t("skillsEmpty")}</FieldDescription>
                  ) : (
                    <div className="flex flex-col divide-y rounded-lg border">
                      {skills.map((skill) => (
                        <div
                          key={skill.id}
                          className="flex items-center justify-between gap-4 px-3 py-2"
                        >
                          <span className="text-sm">
                            {skill.archived
                              ? t("archivedOption", { name: skill.label })
                              : skill.label}
                          </span>
                          <NativeSelect
                            size="sm"
                            aria-label={t("skillLevelLabel", { skill: skill.label })}
                            value={String(levelOf.get(skill.id) ?? "")}
                            onChange={(event) => setLevel(skill.id, event.target.value)}
                          >
                            <NativeSelectOption value="">{t("skillLevelNone")}</NativeSelectOption>
                            {SKILL_LEVELS.map((level) => (
                              <NativeSelectOption key={level} value={level}>
                                {tLevel(String(level) as "1" | "2" | "3")}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                      ))}
                    </div>
                  )}
                  {fieldState.invalid ? <FieldError>{t("fieldErrors.skills")}</FieldError> : null}
                </FieldSet>
              );
            }}
          />

          <Controller
            name="machineIds"
            control={form.control}
            render={({ field, fieldState }) => {
              const selected = new Set(field.value);
              const toggle = (id: string, checked: boolean) =>
                field.onChange(
                  checked ? [...field.value, id] : field.value.filter((value) => value !== id),
                );
              return (
                <FieldSet data-invalid={fieldState.invalid || undefined}>
                  <FieldLegend variant="label">{t("machines")}</FieldLegend>
                  {machines.length === 0 ? (
                    <FieldDescription>{t("machinesEmpty")}</FieldDescription>
                  ) : (
                    <div className="flex flex-col divide-y rounded-lg border">
                      {machines.map((machine) => (
                        <label
                          key={machine.id}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                        >
                          <Checkbox
                            checked={selected.has(machine.id)}
                            onCheckedChange={(checked) => toggle(machine.id, checked)}
                          />
                          {machine.archived
                            ? t("archivedOption", { name: machine.label })
                            : machine.label}
                        </label>
                      ))}
                    </div>
                  )}
                  {fieldState.invalid ? (
                    <FieldError>{t("fieldErrors.machineIds")}</FieldError>
                  ) : null}
                </FieldSet>
              );
            }}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="employee-form" disabled={pending}>
          {pending ? t("submitting") : employee ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
