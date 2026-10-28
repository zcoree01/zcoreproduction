"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { activateKioskAction } from "@/modules/attendance/kiosk-actions";

export function ActivationForm() {
  const t = useTranslations("kiosk");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(false);
      try {
        const result = await activateKioskAction({ code });
        if (result.ok) router.refresh();
        else setError(true);
      } catch {
        setError(true);
      }
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{t("invalidCode")}</AlertDescription>
        </Alert>
      ) : null}
      <Input
        aria-label={t("code")}
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        maxLength={8}
        autoComplete="off"
        autoCapitalize="characters"
        className="h-16 text-center font-mono text-3xl tracking-[0.3em]"
        placeholder="XXXXXXXX"
      />
      <Button
        type="submit"
        size="lg"
        className="h-14 text-lg"
        disabled={pending || code.length !== 8}
      >
        {pending ? t("activating") : t("activate")}
      </Button>
    </form>
  );
}
