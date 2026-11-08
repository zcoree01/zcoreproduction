"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveBillingSettingsAction } from "@/modules/platform/billing-actions";

/** Grace days after a month, warning days before the lock, contact for locked firms. */
export function BillingSettingsForm({
  graceDays,
  warningDays,
  contact,
}: {
  graceDays: number;
  warningDays: number;
  contact: string;
}) {
  const t = useTranslations("platform.billing.settingsForm");
  const tErrors = useTranslations("platform.billing.errors");
  const [grace, setGrace] = useState(String(graceDays));
  const [warning, setWarning] = useState(String(warningDays));
  const [text, setText] = useState(contact);
  const [pending, startTransition] = useTransition();
  const dirty = grace !== String(graceDays) || warning !== String(warningDays) || text !== contact;

  const save = () =>
    startTransition(async () => {
      const result = await saveBillingSettingsAction({
        graceDays: grace,
        warningDays: warning,
        contact: text,
      });
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(tErrors(result.error));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="billing-grace-days">{t("grace")}</FieldLabel>
              <Input
                id="billing-grace-days"
                inputMode="numeric"
                value={grace}
                onChange={(event) => setGrace(event.target.value)}
                className="w-24"
              />
              <FieldDescription>{t("graceHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="billing-warning-days">{t("warning")}</FieldLabel>
              <Input
                id="billing-warning-days"
                inputMode="numeric"
                value={warning}
                onChange={(event) => setWarning(event.target.value)}
                className="w-24"
              />
              <FieldDescription>{t("warningHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="billing-contact">{t("contact")}</FieldLabel>
              <Input
                id="billing-contact"
                maxLength={300}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <FieldDescription>{t("contactHint")}</FieldDescription>
            </Field>
            <div>
              <Button type="submit" disabled={pending || !dirty}>
                {t("save")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
