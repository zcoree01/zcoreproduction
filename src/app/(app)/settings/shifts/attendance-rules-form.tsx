"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { saveAttendanceRulesAction } from "@/modules/attendance/actions";
import {
  attendanceRulesSchema,
  OPERATION_WITHOUT_CLOCK_IN,
  type AttendanceRules,
  type AttendanceRulesFormValues,
} from "@/modules/attendance/schemas";

const NUMBER_FIELDS = [
  "earlyWindowMin",
  "lateToleranceMin",
  "absentAfterMin",
  "autoCloseAfterHours",
] as const;

export function AttendanceRulesForm({ rules }: { rules: AttendanceRules }) {
  const t = useTranslations("shifts.rules");
  const [pending, startTransition] = useTransition();
  const form = useForm<AttendanceRulesFormValues, unknown, AttendanceRules>({
    resolver: zodResolver(attendanceRulesSchema),
    defaultValues: {
      earlyWindowMin: String(rules.earlyWindowMin),
      lateToleranceMin: String(rules.lateToleranceMin),
      absentAfterMin: String(rules.absentAfterMin),
      autoCloseAfterHours: String(rules.autoCloseAfterHours),
      operationWithoutClockIn: rules.operationWithoutClockIn,
    },
  });

  const onSubmit = form.handleSubmit(() =>
    startTransition(async () => {
      const result = await saveAttendanceRulesAction(form.getValues());
      if (result.ok) {
        toast.success(t("savedToast"));
        form.reset(form.getValues());
        return;
      }
      for (const field of result.fields) form.setError(field, { type: "server" });
      if (result.fields.length === 0) toast.error(t(`errors.${result.error}`));
    }),
  );

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              {NUMBER_FIELDS.map((name) => (
                <Controller
                  key={name}
                  name={name}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid || undefined}>
                      <FieldLabel htmlFor={`rules-${name}`}>{t(`fields.${name}`)}</FieldLabel>
                      <Input
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={String(field.value ?? "")}
                        onChange={(event) => field.onChange(event.target.value)}
                        id={`rules-${name}`}
                        inputMode="numeric"
                        className="tabular-nums"
                        aria-invalid={fieldState.invalid || undefined}
                      />
                      {fieldState.invalid ? (
                        <FieldError>{t(`fieldErrors.${name}`)}</FieldError>
                      ) : (
                        <FieldDescription>{t(`hints.${name}`)}</FieldDescription>
                      )}
                    </Field>
                  )}
                />
              ))}
            </div>
            <Controller
              name="operationWithoutClockIn"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="rules-operation">
                    {t("fields.operationWithoutClockIn")}
                  </FieldLabel>
                  <NativeSelect
                    id="rules-operation"
                    className="w-full"
                    value={field.value}
                    onChange={(event) => {
                      const next = OPERATION_WITHOUT_CLOCK_IN.find(
                        (option) => option === event.target.value,
                      );
                      if (next) field.onChange(next);
                    }}
                  >
                    {OPERATION_WITHOUT_CLOCK_IN.map((option) => (
                      <NativeSelectOption key={option} value={option}>
                        {t(`operationModes.${option}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>{t(`operationModeHints.${field.value}`)}</FieldDescription>
                </Field>
              )}
            />
            <div>
              <Button type="submit" disabled={pending || !form.formState.isDirty}>
                {pending ? t("saving") : t("save")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
