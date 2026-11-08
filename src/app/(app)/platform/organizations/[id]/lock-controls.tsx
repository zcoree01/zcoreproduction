"use client";

import { LockIcon, LockOpenIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { setLockAction, unlockUntilAction } from "@/modules/platform/billing-actions";

/** Lock by hand (with a reason) / unlock; "open until" for a firm locked for non-payment. */
export function LockControls({
  organizationId,
  name,
  lockedByHand,
  lockedForPayment,
  unlockedUntil,
}: {
  organizationId: string;
  name: string;
  lockedByHand: boolean;
  /** Locked or overdue because of an unpaid month. */
  lockedForPayment: boolean;
  unlockedUntil: string | null;
}) {
  const t = useTranslations("platform.billing.lock");
  const tErrors = useTranslations("platform.billing.errors");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [until, setUntil] = useState(unlockedUntil ?? "");
  const [pending, startTransition] = useTransition();

  const setLock = (locked: boolean, text: string) =>
    startTransition(async () => {
      const result = await setLockAction({ organizationId, locked, reason: text });
      if (result.ok) {
        toast.success(t(locked ? "lockedToast" : "unlockedToast", { name }));
        setOpen(false);
        setReason("");
      } else if (result.error === "reason_required") {
        setInvalid(true);
      } else {
        toast.error(tErrors(result.error));
      }
    });

  const saveUntil = () =>
    startTransition(async () => {
      const result = await unlockUntilAction({ organizationId, until });
      if (result.ok) toast.success(t("untilToast"));
      else toast.error(tErrors(result.error));
    });

  return (
    <div className="flex flex-wrap items-end gap-2">
      {lockedForPayment ? (
        <div className="flex items-end gap-2">
          <Field className="w-auto">
            <FieldLabel htmlFor="unlock-until">{t("until")}</FieldLabel>
            <Input
              id="unlock-until"
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
              title={t("untilHint")}
            />
          </Field>
          <Button
            variant="outline"
            disabled={pending || until === (unlockedUntil ?? "")}
            onClick={saveUntil}
          >
            {t("untilSave")}
          </Button>
        </div>
      ) : null}
      {lockedByHand ? (
        <Button disabled={pending} onClick={() => setLock(false, "")}>
          <LockOpenIcon />
          {t("unlock")}
        </Button>
      ) : (
        <Button variant="destructive" disabled={pending} onClick={() => setOpen(true)}>
          <LockIcon />
          {t("lock")}
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          <form
            id="platform-lock-form"
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
              setLock(true, trimmed);
            }}
          >
            <FieldGroup>
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="platform-lock-reason">{t("reason")}</FieldLabel>
                <Textarea
                  id="platform-lock-reason"
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
            <Button
              type="submit"
              form="platform-lock-form"
              variant="destructive"
              disabled={pending}
            >
              {t("confirm")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
