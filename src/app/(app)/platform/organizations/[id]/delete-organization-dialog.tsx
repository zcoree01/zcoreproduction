"use client";

import { useTranslations } from "next-intl";
import { cloneElement, useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { scheduleOrganizationDeletionAction } from "@/modules/platform/billing-actions";

/**
 * Two confirmations before a firm is scheduled for deletion: "are you sure",
 * then the full name typed again (exact, case-sensitive; the RPC checks it too).
 */
export function DeleteOrganizationDialog({
  organizationId,
  name,
  formatDate,
  trigger,
}: {
  organizationId: string;
  name: string;
  formatDate: (iso: string) => string;
  trigger: ReactElement<{ onClick?: () => void }>;
}) {
  const t = useTranslations("platform.billing.archive");
  const tErrors = useTranslations("platform.billing.errors");
  const [firstOpen, setFirstOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await scheduleOrganizationDeletionAction({
        orgId: organizationId,
        confirmName: input,
      });
      if (result.ok) {
        toast.success(
          t("scheduledToast", { date: result.deleteAfter ? formatDate(result.deleteAfter) : "" }),
        );
        setSecondOpen(false);
        setInput("");
      } else {
        toast.error(tErrors(result.error));
      }
    });

  return (
    <>
      {cloneElement(trigger, { onClick: () => setFirstOpen(true) })}
      <ConfirmDialog
        open={firstOpen}
        onOpenChange={setFirstOpen}
        title={t("deleteConfirmTitle", { name })}
        description={t("deleteConfirmDescription")}
        confirmLabel={t("deleteConfirmLabel")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => setSecondOpen(true)}
      />
      <AlertDialog
        open={secondOpen}
        onOpenChange={(next) => {
          if (pending) return;
          setSecondOpen(next);
          if (!next) setInput("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="font-medium break-words text-foreground">
              {name}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="platform-delete-name">{t("deleteField")}</FieldLabel>
            <Input
              id="platform-delete-name"
              value={input}
              autoComplete="off"
              onChange={(event) => setInput(event.target.value)}
            />
            <FieldDescription>{t("deleteFieldHint")}</FieldDescription>
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending || input.trim() !== name}
              onClick={submit}
            >
              {t("deleteSubmit")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
