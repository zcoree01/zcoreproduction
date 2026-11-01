"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cancelDeliveryNoteAction } from "@/modules/finished-goods/actions";

export function CancelNoteButton({ noteId, number }: { noteId: string; number: string }) {
  const t = useTranslations("finishedGoods");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cancel = () =>
    startTransition(async () => {
      setError(null);
      const result = await cancelDeliveryNoteAction({ noteId, reason });
      if (result.ok) {
        toast.success(t("notes.cancelled"));
        setOpen(false);
        router.refresh();
      } else {
        setError(t(`errors.${result.error}`));
      }
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <XIcon />
        {t("notes.cancel")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t("notes.cancelTitle", { number })}</SheetTitle>
            <SheetDescription>{t("notes.description")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 p-4">
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="cancel-reason">{t("notes.cancelReason")}</FieldLabel>
              <Textarea
                id="cancel-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </div>
          <SheetFooter className="border-t">
            <Button variant="destructive" disabled={pending} onClick={cancel}>
              {t("notes.cancel")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
