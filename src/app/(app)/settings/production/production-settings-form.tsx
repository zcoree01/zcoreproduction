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
  type CycleTimeUnit,
} from "@/modules/products/schemas";

export function ProductionSettingsForm({ cycleTimeUnit }: { cycleTimeUnit: CycleTimeUnit }) {
  const t = useTranslations("productionSettings");
  const [value, setValue] = useState<CycleTimeUnit>(cycleTimeUnit);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveProductionSettingsAction({ cycleTimeUnit: value });
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("cycleTitle")}</CardTitle>
        <CardDescription>{t("cycleDescription")}</CardDescription>
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
          <div>
            <Button onClick={save} disabled={pending || value === cycleTimeUnit}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
