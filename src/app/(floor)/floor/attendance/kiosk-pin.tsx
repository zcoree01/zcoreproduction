"use client";

import { KeyRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { setOwnPinAction } from "@/modules/attendance/kiosk-admin";

/** The worker sets the 4-digit PIN for the kiosk tablet at the entrance. */
export function KioskPinCard({ pinSet }: { pinSet: boolean }) {
  const t = useTranslations("kioskPin");
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, startTransition] = useTransition();
  const mismatch = repeat.length === 4 && pin !== repeat;

  const save = () =>
    startTransition(async () => {
      try {
        const result = await setOwnPinAction(pin);
        if (result.ok) {
          toast.success(t("savedToast"));
          setPin("");
          setRepeat("");
          router.refresh();
        } else toast.error(t(`errors.${result.error}`));
      } catch {
        toast.error(t("errors.unexpected"));
      }
    });

  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 4);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRoundIcon className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{pinSet ? t("isSet") : t("notSet")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="kiosk-pin">{t("pin")}</FieldLabel>
              <Input
                id="kiosk-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="h-12 text-center font-mono text-xl"
                value={pin}
                onChange={(event) => setPin(digits(event.target.value))}
              />
            </Field>
            <Field data-invalid={mismatch || undefined}>
              <FieldLabel htmlFor="kiosk-pin-repeat">{t("repeat")}</FieldLabel>
              <Input
                id="kiosk-pin-repeat"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="h-12 text-center font-mono text-xl"
                value={repeat}
                aria-invalid={mismatch || undefined}
                onChange={(event) => setRepeat(digits(event.target.value))}
              />
            </Field>
          </div>
          {mismatch ? <p className="text-sm text-destructive">{t("mismatch")}</p> : null}
          <Button
            size="lg"
            className="h-12"
            disabled={pending || pin.length !== 4 || pin !== repeat}
            onClick={save}
          >
            {pending ? t("saving") : pinSet ? t("change") : t("set")}
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
