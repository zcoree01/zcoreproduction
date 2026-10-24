"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { saveProductionSettingsAction } from "@/modules/products/actions";
import {
  CYCLE_TIME_UNITS,
  cycleTimeUnitSchema,
  INSPECTION_MODES,
  type CycleTimeUnit,
  type InspectionMode,
} from "@/modules/products/schemas";

export function ProductionSettingsForm({
  cycleTimeUnit,
  inspectionMode,
}: {
  cycleTimeUnit: CycleTimeUnit;
  inspectionMode: InspectionMode;
}) {
  const t = useTranslations("productionSettings");
  const [value, setValue] = useState<CycleTimeUnit>(cycleTimeUnit);
  const [mode, setMode] = useState<InspectionMode>(inspectionMode);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveProductionSettingsAction({
        cycleTimeUnit: value,
        inspectionMode: mode,
      });
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("cardTitle")}</CardTitle>
        <CardDescription>{t("cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-cycle-unit">{t("cycleTimeUnit")}</FieldLabel>
            <NativeSelect
              id="settings-cycle-unit"
              className="w-full"
              value={value}
              onChange={(event) => {
                const parsed = cycleTimeUnitSchema.safeParse(event.target.value);
                if (parsed.success) setValue(parsed.data);
              }}
            >
              {CYCLE_TIME_UNITS.map((unit) => (
                <NativeSelectOption key={unit} value={unit}>
                  {t(`units.${unit}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{t("cycleTimeUnitHint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-inspection-mode">{t("inspectionMode")}</FieldLabel>
            <NativeSelect
              id="settings-inspection-mode"
              className="w-full"
              value={mode}
              onChange={(event) => {
                const next = INSPECTION_MODES.find((option) => option === event.target.value);
                if (next) setMode(next);
              }}
            >
              {INSPECTION_MODES.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {t(`inspectionModes.${option}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{t(`inspectionModeHints.${mode}`)}</FieldDescription>
          </Field>
          <div>
            <Button
              onClick={save}
              disabled={pending || (value === cycleTimeUnit && mode === inspectionMode)}
            >
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
