"use client";

import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

// Body for error.tsx boundaries and failed sections. Never shows raw error text.
export function ErrorState({
  error,
  retry,
  title,
  description,
}: {
  error?: unknown;
  retry?: () => void;
  title?: string;
  description?: string;
}) {
  const t = useTranslations();

  useEffect(() => {
    if (error) console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={<TriangleAlertIcon className="text-destructive" />}
      title={title ?? t("errors.title")}
      description={description ?? t("errors.description")}
      action={
        retry ? (
          <Button variant="outline" onClick={() => retry()}>
            <RotateCwIcon />
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    />
  );
}
