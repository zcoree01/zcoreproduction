"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveLeaveRulesAction } from "@/modules/attendance/absence-actions";
import { LEAVE_RULES_FIELDS, type LeaveRulesField } from "@/modules/attendance/absence-schemas";
import type { LeaveRules } from "@/modules/attendance/leave-rules";

const FROM_RULES: Record<LeaveRulesField, keyof LeaveRules> = {
  leaveBaseDays: "baseDays",
  leaveExtraDays: "extraDays",
  leaveExtraEveryYears: "extraEveryYears",
  leaveMaxDays: "maxDays",
  leaveProbationMonths: "probationMonths",
};

/** Annual leave rules of the organization (shifts.manage). */
export function LeaveRulesForm({ rules }: { rules: LeaveRules }) {
  const t = useTranslations("shifts.leave");
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<LeaveRulesField, string>>(
    () =>
      Object.fromEntries(
        LEAVE_RULES_FIELDS.map((field) => [field, String(rules[FROM_RULES[field]])]),
      ) as Record<LeaveRulesField, string>,
  );

  const save = () =>
    startTransition(async () => {
      try {
        const result = await saveLeaveRulesAction(values);
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

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            {LEAVE_RULES_FIELDS.map((field) => (
              <Field key={field}>
                <FieldLabel htmlFor={`leave-${field}`}>{t(`fields.${field}`)}</FieldLabel>
                <Input
                  id={`leave-${field}`}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={values[field]}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field]: event.target.value }))
                  }
                />
                <FieldDescription>{t(`hints.${field}`)}</FieldDescription>
              </Field>
            ))}
          </div>
          <div>
            <Button onClick={save} disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
