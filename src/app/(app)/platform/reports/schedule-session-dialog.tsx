"use client";

import { CalendarClockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { zonedLocalToUtc } from "@/lib/timezone";
import { scheduleSupportSessionAction } from "@/modules/platform/reports-actions";

const PLATFORM_TIMEZONE = "Europe/Sarajevo";
const DURATIONS = [15, 30, 60, 120, 240, 480] as const;

/** "Zakaži sesiju": Zcore proposes a window, the firm's admin approves it. */
export function ScheduleSessionDialog({ reportId }: { reportId: string }) {
  const t = useTranslations("platformReports.schedule");
  const tSupport = useTranslations("support");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [minutes, setMinutes] = useState<number>(60);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      if (!date || !time) {
        toast.error(t("errors.invalid"));
        return;
      }
      const result = await scheduleSupportSessionAction({
        reportId,
        start: zonedLocalToUtc(`${date}T${time}`, PLATFORM_TIMEZONE),
        minutes,
        reason,
      });
      if (result.ok) {
        toast.success(t("done"));
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CalendarClockIcon />
        {t("button")}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <CalendarClockIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="schedule-date">{t("date")}</FieldLabel>
                <Input
                  id="schedule-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="schedule-time">{t("time")}</FieldLabel>
                <Input
                  id="schedule-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="schedule-minutes">{t("duration")}</FieldLabel>
              <NativeSelect
                id="schedule-minutes"
                className="w-full"
                value={String(minutes)}
                onChange={(event) => setMinutes(Number(event.target.value))}
              >
                {DURATIONS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {tSupport("minutes", { minutes: value })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="schedule-reason">{t("reason")}</FieldLabel>
              <Textarea
                id="schedule-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </div>
          <AlertDialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || reason.trim() === ""} onClick={submit}>
              {t("submit")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
