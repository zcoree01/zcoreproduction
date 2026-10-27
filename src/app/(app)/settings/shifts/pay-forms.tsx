"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { savePaySettingsAction, saveCalcRulesAction } from "@/modules/attendance/payroll-actions";
import type { CalcSettings } from "@/modules/attendance/payroll-queries";
import type { PayrollActionResult } from "@/modules/attendance/payroll-schemas";
import type { IsoWeekday } from "@/modules/attendance/schedule-rules";

const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

function useSave(namespace: "shifts.calc" | "shifts.pay") {
  const t = useTranslations(namespace);
  const [pending, startTransition] = useTransition();
  const save = (action: () => Promise<PayrollActionResult>) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) toast.success(t("savedToast"));
        else
          toast.error(
            t(
              `errors.${result.error === "denied" || result.error === "invalid" ? result.error : "unexpected"}`,
            ),
          );
      } catch {
        toast.error(t("errors.unexpected"));
      }
    });
  return { t, pending, save };
}

/** Overtime (daily / weekly, rounding up), night window and weekend days (shifts.manage). */
export function CalcRulesForm({ settings }: { settings: CalcSettings }) {
  const { t, pending, save } = useSave("shifts.calc");
  const tDays = useTranslations("schedule");
  const [mode, setMode] = useState(settings.overtimeMode);
  const [weeklyHours, setWeeklyHours] = useState(String(settings.weeklyHours));
  const [warning, setWarning] = useState(String(settings.weeklyOvertimeWarningHours));
  const [step, setStep] = useState(String(settings.overtimeStepMin));
  const [nightStart, setNightStart] = useState(settings.nightStart);
  const [nightEnd, setNightEnd] = useState(settings.nightEnd);
  const [weekendDays, setWeekendDays] = useState<IsoWeekday[]>(settings.weekendDays);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="calc-mode">{t("fields.overtimeMode")}</FieldLabel>
            <NativeSelect
              id="calc-mode"
              className="w-full"
              value={mode}
              onChange={(event) => setMode(event.target.value === "weekly" ? "weekly" : "daily")}
            >
              <NativeSelectOption value="daily">{t("modes.daily")}</NativeSelectOption>
              <NativeSelectOption value="weekly">{t("modes.weekly")}</NativeSelectOption>
            </NativeSelect>
            <FieldDescription>{t(`modeHints.${mode}`)}</FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="calc-weekly">{t("fields.weeklyHours")}</FieldLabel>
              <Input
                id="calc-weekly"
                inputMode="numeric"
                value={weeklyHours}
                onChange={(event) => setWeeklyHours(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calc-warning">{t("fields.warning")}</FieldLabel>
              <Input
                id="calc-warning"
                inputMode="numeric"
                value={warning}
                onChange={(event) => setWarning(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calc-step">{t("fields.step")}</FieldLabel>
              <Input
                id="calc-step"
                inputMode="numeric"
                value={step}
                onChange={(event) => setStep(event.target.value)}
              />
            </Field>
          </div>
          <FieldDescription>{t("weeklyHint")}</FieldDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="calc-night-start">{t("fields.nightStart")}</FieldLabel>
              <Input
                id="calc-night-start"
                type="time"
                value={nightStart}
                onChange={(event) => setNightStart(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calc-night-end">{t("fields.nightEnd")}</FieldLabel>
              <Input
                id="calc-night-end"
                type="time"
                value={nightEnd}
                onChange={(event) => setNightEnd(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel>{t("fields.weekendDays")}</FieldLabel>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day) => (
                <label key={day} className="flex items-center gap-1 text-sm">
                  <Checkbox
                    checked={weekendDays.includes(day)}
                    onCheckedChange={(value) =>
                      setWeekendDays((current) =>
                        value === true
                          ? [...current, day].sort()
                          : current.filter((item) => item !== day),
                      )
                    }
                  />
                  {tDays(`weekdays.${day}`)}
                </label>
              ))}
            </div>
            <FieldDescription>{t("weekendHint")}</FieldDescription>
          </Field>
          <div>
            <Button
              disabled={pending}
              onClick={() =>
                save(() =>
                  saveCalcRulesAction({
                    overtimeMode: mode,
                    weeklyHours,
                    weeklyOvertimeWarningHours: warning,
                    overtimeStepMin: step,
                    nightStart,
                    nightEnd,
                    weekendDays,
                  }),
                )
              }
            >
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

const PAY_FIELDS = [
  "overtimePct",
  "nightPct",
  "weekendPct",
  "holidayPct",
  "defaultHourlyRate",
] as const;
type PayField = (typeof PAY_FIELDS)[number];

/** Premiums and the default net hourly rate (payroll.manage). */
export function PaySettingsForm({ values }: { values: Record<PayField, string> }) {
  const { t, pending, save } = useSave("shifts.pay");
  const [state, setState] = useState(values);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            {PAY_FIELDS.map((field) => (
              <Field key={field}>
                <FieldLabel htmlFor={`pay-${field}`}>{t(`fields.${field}`)}</FieldLabel>
                <Input
                  id={`pay-${field}`}
                  inputMode="decimal"
                  className="tabular-nums"
                  value={state[field]}
                  onChange={(event) =>
                    setState((current) => ({ ...current, [field]: event.target.value }))
                  }
                />
              </Field>
            ))}
          </div>
          <FieldDescription>{t("hint")}</FieldDescription>
          <div>
            <Button disabled={pending} onClick={() => save(() => savePaySettingsAction(state))}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
