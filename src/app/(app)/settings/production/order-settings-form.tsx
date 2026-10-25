"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { saveOrderSettingsAction } from "@/modules/production-orders/actions";
import {
  formatOrderNumber,
  isValidOrderNumberTemplate,
  ORDER_NUMBER_TOKENS,
  type OrderSettings,
  type PriorityMode,
} from "@/modules/production-orders/rules";
import type { OrderSettingsField } from "@/modules/production-orders/schemas";

export function OrderSettingsForm({
  settings,
  today,
}: {
  settings: OrderSettings;
  /** Today in the organization's time zone, for the number preview. */
  today: string;
}) {
  const t = useTranslations("productionSettings.orders");
  const [template, setTemplate] = useState(settings.numberTemplate);
  const [digits, setDigits] = useState(String(settings.numberDigits));
  const [mode, setMode] = useState<PriorityMode>(settings.priorityMode);
  const [thresholds, setThresholds] = useState(settings.priorityThresholds.map(String));
  const [warningDays, setWarningDays] = useState(settings.dueWarningDays.join(", "));
  const [hours, setHours] = useState(String(settings.workHoursPerDay));
  const [invalid, setInvalid] = useState<OrderSettingsField[]>([]);
  const [pending, startTransition] = useTransition();

  const digitsValue = Number(digits);
  const preview =
    isValidOrderNumberTemplate(template) && digitsValue >= 1 && digitsValue <= 6
      ? formatOrderNumber(template, digitsValue, 13, today, 358)
      : null;

  const save = () =>
    startTransition(async () => {
      setInvalid([]);
      const result = await saveOrderSettingsAction({
        numberTemplate: template,
        numberDigits: digits,
        priorityMode: mode,
        priorityThresholds: thresholds,
        dueWarningDays: warningDays
          .split(/[,\s]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        workHoursPerDay: hours,
      });
      if (result.ok) {
        toast.success(t("savedToast"));
        return;
      }
      setInvalid(result.fields);
      toast.error(t(`errors.${result.error}`));
    });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("cardTitle")}</CardTitle>
        <CardDescription>{t("cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field data-invalid={invalid.includes("numberTemplate") || undefined}>
            <FieldLabel htmlFor="settings-order-template">{t("template")}</FieldLabel>
            <Input
              id="settings-order-template"
              value={template}
              className="font-mono"
              autoComplete="off"
              onChange={(event) => setTemplate(event.target.value)}
              aria-invalid={!isValidOrderNumberTemplate(template) || undefined}
            />
            <div className="flex flex-wrap gap-1">
              {ORDER_NUMBER_TOKENS.map((token) => (
                <Button
                  key={token}
                  type="button"
                  size="xs"
                  variant="outline"
                  className="font-mono"
                  onClick={() => setTemplate((value) => `${value}{${token}}`)}
                >
                  {`{${token}}`}
                </Button>
              ))}
            </div>
            {isValidOrderNumberTemplate(template) ? (
              <FieldDescription>{t("templateHint")}</FieldDescription>
            ) : (
              <FieldError>{t("templateInvalid")}</FieldError>
            )}
          </Field>
          <Field data-invalid={invalid.includes("numberDigits") || undefined}>
            <FieldLabel htmlFor="settings-order-digits">{t("digits")}</FieldLabel>
            <NativeSelect
              id="settings-order-digits"
              className="w-full"
              value={digits}
              onChange={(event) => setDigits(event.target.value)}
            >
              {["1", "2", "3", "4", "5", "6"].map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{t("digitsHint")}</FieldDescription>
          </Field>
          <p className="rounded-lg bg-muted px-3 py-2 text-sm" data-testid="order-number-preview">
            {preview ? t("preview", { number: preview }) : t("previewInvalid")}
          </p>

          <Field>
            <FieldLabel htmlFor="settings-priority-mode">{t("priorityMode")}</FieldLabel>
            <NativeSelect
              id="settings-priority-mode"
              className="w-full"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value === "automatic" ? "automatic" : "manual")
              }
            >
              <NativeSelectOption value="manual">{t("priorityModes.manual")}</NativeSelectOption>
              <NativeSelectOption value="automatic">
                {t("priorityModes.automatic")}
              </NativeSelectOption>
            </NativeSelect>
            <FieldDescription>{t(`priorityModeHints.${mode}`)}</FieldDescription>
          </Field>
          <FieldSet data-invalid={invalid.includes("priorityThresholds") || undefined}>
            <FieldLegend variant="label">{t("thresholds")}</FieldLegend>
            <FieldDescription>{t("thresholdsHint")}</FieldDescription>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {thresholds.map((value, index) => (
                <Field key={index}>
                  <FieldLabel htmlFor={`settings-threshold-${index}`}>
                    {t("thresholdLabel", { level: index + 1 })}
                  </FieldLabel>
                  <Input
                    id={`settings-threshold-${index}`}
                    inputMode="numeric"
                    value={value}
                    onChange={(event) =>
                      setThresholds((current) =>
                        current.map((item, i) => (i === index ? event.target.value : item)),
                      )
                    }
                  />
                </Field>
              ))}
            </div>
            {invalid.includes("priorityThresholds") ? (
              <FieldError>{t("thresholdsInvalid")}</FieldError>
            ) : null}
          </FieldSet>
          <Field data-invalid={invalid.includes("workHoursPerDay") || undefined}>
            <FieldLabel htmlFor="settings-work-hours">{t("workHours")}</FieldLabel>
            <Input
              id="settings-work-hours"
              inputMode="numeric"
              className="max-w-32"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
            <FieldDescription>{t("workHoursHint")}</FieldDescription>
          </Field>
          <Field data-invalid={invalid.includes("dueWarningDays") || undefined}>
            <FieldLabel htmlFor="settings-warning-days">{t("warningDays")}</FieldLabel>
            <Input
              id="settings-warning-days"
              value={warningDays}
              className="max-w-48"
              onChange={(event) => setWarningDays(event.target.value)}
            />
            {invalid.includes("dueWarningDays") ? (
              <FieldError>{t("warningDaysInvalid")}</FieldError>
            ) : (
              <FieldDescription>{t("warningDaysHint")}</FieldDescription>
            )}
          </Field>
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
