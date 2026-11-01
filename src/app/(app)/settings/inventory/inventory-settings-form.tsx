"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDecimal } from "@/lib/decimal";
import { saveInventorySettingsAction } from "@/modules/inventory/actions";
import type { InventorySettings } from "@/modules/inventory/rules";

export function InventorySettingsForm({ settings }: { settings: InventorySettings }) {
  const t = useTranslations("inventory");
  const [remnant, setRemnant] = useState(settings.remnantMinLengthMm);
  const [vatRate, setVatRate] = useState(formatDecimal(settings.vatRate));
  const [includesVat, setIncludesVat] = useState(settings.pricesIncludeVat);
  const [failure, setFailure] = useState<{ error: string; fields: readonly string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = (field: string) => failure?.fields.includes(field) ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const result = await saveInventorySettingsAction({
        remnantMinLengthMm: remnant,
        vatRate,
        pricesIncludeVat: includesVat,
      });
      if (result.ok) toast.success(t("settings.saved"));
      else setFailure({ error: result.error, fields: result.fields });
    });
  };

  return (
    <Card className="max-w-2xl">
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            {failure && failure.fields.length === 0 ? (
              <Alert variant="destructive">
                <AlertDescription>{t(`errors.${failure.error as "unexpected"}`)}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={invalid("remnantMinLengthMm") || undefined}>
              <FieldLabel htmlFor="inventory-remnant">{t("settings.remnantMinLength")}</FieldLabel>
              <Input
                id="inventory-remnant"
                inputMode="numeric"
                className="max-w-40"
                value={remnant}
                onChange={(event) => setRemnant(event.target.value)}
                aria-invalid={invalid("remnantMinLengthMm") || undefined}
              />
              {invalid("remnantMinLengthMm") ? (
                <FieldError>{t("errors.invalid")}</FieldError>
              ) : (
                <FieldDescription>{t("settings.remnantHint")}</FieldDescription>
              )}
            </Field>
            <Field data-invalid={invalid("vatRate") || undefined}>
              <FieldLabel htmlFor="inventory-vat">{t("settings.vatRate")}</FieldLabel>
              <Input
                id="inventory-vat"
                inputMode="decimal"
                className="max-w-40"
                value={vatRate}
                onChange={(event) => setVatRate(event.target.value)}
                aria-invalid={invalid("vatRate") || undefined}
              />
              {invalid("vatRate") ? <FieldError>{t("errors.invalid")}</FieldError> : null}
            </Field>
            <Field>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={includesVat}
                  onCheckedChange={(value) => setIncludesVat(value === true)}
                />
                {t("settings.pricesIncludeVat")}
              </Label>
              <FieldDescription>{t("settings.pricesIncludeVatHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("settings.costing")}</FieldLabel>
              <FieldDescription>{t("settings.costingValue")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("settings.negative")}</FieldLabel>
              <FieldDescription>{t("settings.negativeValue")}</FieldDescription>
            </Field>
            <div>
              <Button type="submit" disabled={pending}>
                {t("settings.save")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
