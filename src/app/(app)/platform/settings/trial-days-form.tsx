"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { setTrialDaysAction } from "@/modules/platform/actions";
import { trialDaysSchema } from "@/modules/platform/schemas";

export function TrialDaysForm({ initial }: { initial: number }) {
  const t = useTranslations("platform.trial");
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(String(initial));
  const [pending, startTransition] = useTransition();
  const valid = trialDaysSchema.safeParse(value).success;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await setTrialDaysAction(value);
              if (result.ok) {
                setSaved(value);
                toast.success(t("savedToast", { days: Number(value) }));
              } else {
                toast.error(t(`errors.${result.error}`));
              }
            });
          }}
        >
          <Field data-invalid={!valid || undefined} className="w-40">
            <FieldLabel htmlFor="trial-days">{t("days")}</FieldLabel>
            <Input
              id="trial-days"
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={!valid || undefined}
            />
            {valid ? (
              <FieldDescription>{t("hint")}</FieldDescription>
            ) : (
              <FieldError>{t("invalid")}</FieldError>
            )}
          </Field>
          <Button type="submit" disabled={!valid || pending || value === saved}>
            {pending ? t("saving") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
