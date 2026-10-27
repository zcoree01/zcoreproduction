"use client";

import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { enterCorrectionAction } from "@/modules/attendance/absence-actions";

type SessionOption = { id: string; clockIn: string; clockOut: string | null; label: string };

/**
 * The foreman corrects a worker's attendance from the board: fix a session or
 * add a missing one, always with a reason. Applied at once for other
 * employees (the original stays archived); for the foreman's own attendance
 * it becomes a request for admin / director.
 */
export function CorrectionEntry({
  employeeId,
  employeeName,
  sessions,
  defaultDay,
}: {
  employeeId: string;
  employeeName: string;
  sessions: SessionOption[];
  defaultDay: string;
}) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const first = sessions.at(-1);
  const [sessionId, setSessionId] = useState(first?.id ?? "");
  const [clockIn, setClockIn] = useState(first?.clockIn ?? `${defaultDay}T06:00`);
  const [clockOut, setClockOut] = useState(
    first?.clockOut ?? first?.clockIn ?? `${defaultDay}T14:00`,
  );
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const choose = (id: string) => {
    setSessionId(id);
    const session = sessions.find((item) => item.id === id);
    setClockIn(session?.clockIn ?? `${defaultDay}T06:00`);
    setClockOut(session?.clockOut ?? session?.clockIn ?? `${defaultDay}T14:00`);
  };

  const submit = () =>
    startTransition(async () => {
      try {
        const result = await enterCorrectionAction({
          employeeId,
          sessionId,
          clockIn,
          clockOut,
          reason,
          idempotencyKey,
        });
        if (!result.ok) {
          toast.error(t(`errors.${result.error}`));
          return;
        }
        toast.success(t("correctionSavedToast", { name: employeeName }));
        setIdempotencyKey(crypto.randomUUID());
        setReason("");
        setOpen(false);
        router.refresh();
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("correctFor", { name: employeeName })}
        onClick={() => setOpen(true)}
      >
        <PencilIcon />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t("correctFor", { name: employeeName })}</SheetTitle>
            <SheetDescription>{t("correctDescription")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="correct-session">{t("fields.session")}</FieldLabel>
                <NativeSelect
                  id="correct-session"
                  className="w-full"
                  value={sessionId}
                  onChange={(event) => choose(event.target.value)}
                >
                  {sessions.map((session) => (
                    <NativeSelectOption key={session.id} value={session.id}>
                      {session.label}
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value="">{t("newSession")}</NativeSelectOption>
                </NativeSelect>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="correct-in">{t("fields.clockIn")}</FieldLabel>
                  <Input
                    id="correct-in"
                    type="datetime-local"
                    value={clockIn}
                    onChange={(event) => setClockIn(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="correct-out">{t("fields.clockOut")}</FieldLabel>
                  <Input
                    id="correct-out"
                    type="datetime-local"
                    value={clockOut}
                    onChange={(event) => setClockOut(event.target.value)}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="correct-reason">{t("fields.correctionReason")}</FieldLabel>
                <Textarea
                  id="correct-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
                <FieldDescription>{t("correctHint")}</FieldDescription>
              </Field>
            </FieldGroup>
          </div>
          <SheetFooter className="border-t">
            <Button disabled={pending || reason.trim() === ""} onClick={submit}>
              {pending ? t("sending") : t("save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
