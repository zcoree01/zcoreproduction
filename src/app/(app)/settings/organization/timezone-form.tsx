"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { saveOrganizationTimezoneAction } from "@/modules/organizations/actions";

type Option = { value: string; label: string };

export function TimezoneForm({ timezone, options }: { timezone: string; options: Option[] }) {
  const t = useTranslations("organizationSettings");
  const format = useFormatter();
  const [value, setValue] = useState(timezone);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  // Set after mount: the clock differs between the server render and the browser.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const label = options.find((option) => option.value === value)?.label ?? value;

  const save = () =>
    startTransition(async () => {
      const result = await saveOrganizationTimezoneAction({ timezone: value });
      setConfirming(false);
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("timezoneTitle")}</CardTitle>
        <CardDescription>{t("timezoneDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="organization-timezone">{t("timezone")}</FieldLabel>
            <NativeSelect
              id="organization-timezone"
              className="w-full"
              value={value}
              disabled={pending}
              onChange={(event) => {
                const next = options.find((option) => option.value === event.target.value);
                if (next) setValue(next.value);
              }}
            >
              {options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              {now
                ? t("timezoneHint", {
                    time: format.dateTime(now, {
                      weekday: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: value,
                    }),
                  })
                : " "}
            </FieldDescription>
          </Field>
          <div>
            <Button onClick={() => setConfirming(true)} disabled={pending || value === timezone}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("confirmTitle")}
        description={t("confirmDescription", { zone: label })}
        confirmLabel={t("confirm")}
        onConfirm={save}
      />
    </Card>
  );
}
