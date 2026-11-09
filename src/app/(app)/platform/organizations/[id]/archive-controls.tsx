"use client";

import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveOrganizationAction,
  cancelOrganizationDeletionAction,
  restoreOrganizationAction,
} from "@/modules/platform/billing-actions";
import { DeleteOrganizationDialog } from "./delete-organization-dialog";

/** Archive (with a reason), restore, delete (two confirmations) and cancel a scheduled deletion. */
export function ArchiveControls({
  organizationId,
  name,
  timezone,
  archived,
  deletionScheduled,
  canArchive,
  canDelete,
}: {
  organizationId: string;
  name: string;
  timezone: string;
  archived: boolean;
  deletionScheduled: boolean;
  canArchive: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("platform.billing.archive");
  const tErrors = useTranslations("platform.billing.errors");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  const archive = (text: string) =>
    startTransition(async () => {
      const result = await archiveOrganizationAction({ orgId: organizationId, reason: text });
      if (result.ok) {
        toast.success(t("archivedToast", { name }));
        setOpen(false);
        setReason("");
      } else if (result.error === "reason_required") {
        setInvalid(true);
      } else {
        toast.error(tErrors(result.error));
      }
    });

  const restore = () =>
    startTransition(async () => {
      const result = await restoreOrganizationAction({ orgId: organizationId });
      if (result.ok) toast.success(t("restoredToast", { name }));
      else toast.error(tErrors(result.error));
    });

  const cancelDeletion = () =>
    startTransition(async () => {
      const result = await cancelOrganizationDeletionAction({ orgId: organizationId });
      if (result.ok) toast.success(t("cancelledToast", { name }));
      else toast.error(tErrors(result.error));
    });

  const scheduledDate = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long", timeZone: timezone });

  return (
    <div className="flex flex-wrap items-end justify-end gap-2">
      {!archived && canArchive ? (
        <Button variant="outline" disabled={pending} onClick={() => setOpen(true)}>
          <ArchiveIcon />
          {t("archive")}
        </Button>
      ) : null}
      {archived && !deletionScheduled && canArchive ? (
        <Button variant="outline" disabled={pending} onClick={restore}>
          <ArchiveRestoreIcon />
          {t("restore")}
        </Button>
      ) : null}
      {archived && !deletionScheduled && canDelete ? (
        <DeleteOrganizationDialog
          organizationId={organizationId}
          name={name}
          formatDate={scheduledDate}
          trigger={
            <Button variant="destructive" disabled={pending}>
              <Trash2Icon />
              {t("delete")}
            </Button>
          }
        />
      ) : null}
      {archived && deletionScheduled && canDelete ? (
        <Button variant="outline" disabled={pending} onClick={cancelDeletion}>
          <Undo2Icon />
          {t("cancelDeletion")}
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          <form
            id="platform-archive-form"
            className="flex-1 overflow-y-auto p-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = reason.trim();
              if (trimmed.length === 0 || trimmed.length > 300) {
                setInvalid(true);
                return;
              }
              setInvalid(false);
              archive(trimmed);
            }}
          >
            <FieldGroup>
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="platform-archive-reason">{t("reason")}</FieldLabel>
                <Textarea
                  id="platform-archive-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  aria-invalid={invalid || undefined}
                />
                {invalid ? (
                  <FieldError>{tErrors("reason_required")}</FieldError>
                ) : (
                  <FieldDescription>{t("reasonHint")}</FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </form>
          <SheetFooter className="border-t">
            <Button type="submit" form="platform-archive-form" disabled={pending}>
              {t("confirm")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
