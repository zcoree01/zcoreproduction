"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Shared body for error.tsx boundaries.
export function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-12">
      <Alert variant="destructive">
        <AlertTitle>{t("errors.title")}</AlertTitle>
        <AlertDescription>{t("errors.description")}</AlertDescription>
      </Alert>
      <Button onClick={() => retry()} variant="outline" className="self-start">
        {t("common.retry")}
      </Button>
    </div>
  );
}
