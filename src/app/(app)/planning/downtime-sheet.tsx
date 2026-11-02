"use client";

import { WrenchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { saveDowntimeAction } from "@/modules/planning/actions";
import type { PlanningDowntime } from "@/modules/planning/queries";

type Option = { id: string; label: string };

/** "Zastoj mašine" in the page header: a new downtime for any machine. */
export function DowntimeButton({
  machines,
  reasons,
  today,
}: {
  machines: Option[];
  reasons: { id: string; name: string }[];
  today: string;
}) {
  const t = useTranslations("planning.downtime");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <WrenchIcon />
        {t("button")}
      </Button>
      <DowntimeSheet
        open={open}
        onOpenChange={setOpen}
        machines={machines}
        reasons={reasons}
        initial={{ machineId: machines[0]?.id ?? "", startsOn: today }}
      />
    </>
  );
}

/**
 * New or changed downtime of a machine: from a day, until a day or until
 * further notice (the end is often not known yet).
 */
export function DowntimeSheet({
  open,
  onOpenChange,
  machines,
  reasons,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machines: Option[];
  reasons: { id: string; name: string }[];
  initial: Partial<PlanningDowntime> & { machineId: string; startsOn: string };
}) {
  const t = useTranslations("planning.downtime");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        {open ? (
          <DowntimeForm
            machines={machines}
            reasons={reasons}
            initial={initial}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DowntimeForm({
  machines,
  reasons,
  initial,
  onDone,
}: {
  machines: Option[];
  reasons: { id: string; name: string }[];
  initial: Partial<PlanningDowntime> & { machineId: string; startsOn: string };
  onDone: () => void;
}) {
  const t = useTranslations("planning");
  const [machineId, setMachineId] = useState(initial.machineId);
  const [startsOn, setStartsOn] = useState(initial.startsOn);
  const [open, setOpen] = useState(initial.id ? initial.endsOn === null : true);
  const [endsOn, setEndsOn] = useState(initial.endsOn ?? initial.startsOn);
  const [reasonId, setReasonId] = useState(initial.reasonId ?? "");
  const [note, setNote] = useState(initial.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveDowntimeAction({
        id: initial.id ?? null,
        machineId,
        startsOn,
        endsOn: open ? null : endsOn,
        reasonId: reasonId || null,
        note,
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("downtime.saved"));
      onDone();
    });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("downtime.title")}</SheetTitle>
        <SheetDescription>{t("downtime.description")}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="downtime-machine">{t("downtime.machine")}</FieldLabel>
            <NativeSelect
              id="downtime-machine"
              className="w-full"
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
            >
              {machines.map((machine) => (
                <NativeSelectOption key={machine.id} value={machine.id}>
                  {machine.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="downtime-from">{t("downtime.startsOn")}</FieldLabel>
            <Input
              id="downtime-from"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="downtime-open"
              checked={open}
              onCheckedChange={(checked) => setOpen(checked === true)}
            />
            <FieldLabel htmlFor="downtime-open">{t("downtime.untilFurther")}</FieldLabel>
          </Field>
          {open ? null : (
            <Field data-invalid={endsOn < startsOn || undefined}>
              <FieldLabel htmlFor="downtime-to">{t("downtime.endsOn")}</FieldLabel>
              <Input
                id="downtime-to"
                type="date"
                min={startsOn}
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="downtime-reason">{t("downtime.reason")}</FieldLabel>
            <NativeSelect
              id="downtime-reason"
              className="w-full"
              value={reasonId}
              onChange={(event) => setReasonId(event.target.value)}
            >
              <NativeSelectOption value="">{t("downtime.noReason")}</NativeSelectOption>
              {reasons.map((reason) => (
                <NativeSelectOption key={reason.id} value={reason.id}>
                  {reason.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="downtime-note">{t("downtime.note")}</FieldLabel>
            <Textarea
              id="downtime-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button
          onClick={save}
          disabled={pending || machineId === "" || startsOn === "" || (!open && endsOn < startsOn)}
        >
          {t("downtime.save")}
        </Button>
      </SheetFooter>
    </>
  );
}
