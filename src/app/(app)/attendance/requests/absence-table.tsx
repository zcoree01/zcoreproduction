"use client";

import { FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/format";
import {
  absenceDocumentUrlAction,
  cancelAbsenceAction,
  enterAbsenceAction,
} from "@/modules/attendance/absence-actions";
import type { AbsenceRow } from "@/modules/attendance/absence-queries";
import {
  ABSENCE_KINDS,
  type AbsenceKind,
  type RequestStatus,
} from "@/modules/attendance/absence-schemas";
import type { ScheduleEmployee } from "@/modules/attendance/schedule-queries";

const TONES: Record<RequestStatus, StatusTone> = {
  requested: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function AbsenceTable({
  absences,
  canManage,
  sensitive,
}: {
  absences: AbsenceRow[];
  canManage: boolean;
  sensitive: boolean;
}) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const cancel = (absence: AbsenceRow) =>
    startTransition(async () => {
      try {
        const result = await cancelAbsenceAction(absence.id, "");
        if (result.ok) {
          toast.success(t("cancelledToast"));
          router.refresh();
        } else toast.error(t(`errors.${result.error}`));
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  const openDocument = (absence: AbsenceRow) =>
    startTransition(async () => {
      const result = await absenceDocumentUrlAction(absence.id);
      if (result.ok) window.open(result.url, "_blank", "noopener");
      else toast.error(t("errors.document_hidden"));
    });

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.employee")}</TableHead>
            <TableHead>{t("columns.kind")}</TableHead>
            <TableHead>{t("columns.period")}</TableHead>
            <TableHead className="text-right">{t("columns.days")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.note")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {absences.map((absence) => (
            <TableRow key={absence.id} data-testid="absence-row">
              <TableCell className="font-medium">{absence.employeeName}</TableCell>
              <TableCell>{t(`kinds.${absence.kind}`)}</TableCell>
              <TableCell className="tabular-nums">
                {formatDay(absence.startDate)}
                {absence.endDate !== absence.startDate ? ` – ${formatDay(absence.endDate)}` : ""}
              </TableCell>
              <TableCell className="text-right tabular-nums">{absence.workingDays}</TableCell>
              <TableCell>
                <StatusBadge tone={TONES[absence.status]}>
                  {t(`statuses.${absence.status}`)}
                </StatusBadge>
              </TableCell>
              <TableCell className="max-w-72 text-sm">
                {absence.note}
                {sensitive && absence.reason ? (
                  <div className="text-muted-foreground">
                    {t("reasonLabel", { reason: absence.reason })}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  {sensitive && absence.hasDocument ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => openDocument(absence)}
                    >
                      <FileTextIcon />
                      {t("document")}
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => cancel(absence)}
                    >
                      <XIcon />
                      {t("cancel")}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function AbsenceEntryButton({
  employees,
  today,
}: {
  employees: ScheduleEmployee[];
  today: string;
}) {
  const t = useTranslations("absences");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("enterAbsence")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {open ? (
            <EntryForm employees={employees} today={today} onDone={() => setOpen(false)} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function EntryForm({
  employees,
  today,
  onDone,
}: {
  employees: ScheduleEmployee[];
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("vacation");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const submit = () =>
    startTransition(async () => {
      try {
        const result = await enterAbsenceAction({
          employeeId,
          kind,
          startDate,
          endDate,
          note,
          reason: kind === "sick" ? reason : "",
          idempotencyKey,
        });
        if (!result.ok) {
          toast.error(t(`errors.${result.error}`));
          return;
        }
        toast.success(t("enteredToast"));
        router.refresh();
        onDone();
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("enterAbsence")}</SheetTitle>
        <SheetDescription>{t("enterDescription")}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="entry-employee">{t("fields.employee")}</FieldLabel>
            <NativeSelect
              id="entry-employee"
              className="w-full"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
              {employees.map((employee) => (
                <NativeSelectOption key={employee.id} value={employee.id}>
                  {employee.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="entry-kind">{t("fields.kind")}</FieldLabel>
            <NativeSelect
              id="entry-kind"
              className="w-full"
              value={kind}
              onChange={(event) => {
                const next = ABSENCE_KINDS.find((item) => item === event.target.value);
                if (next) setKind(next);
              }}
            >
              {ABSENCE_KINDS.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {t(`kinds.${item}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="entry-start">{t("fields.startDate")}</FieldLabel>
              <Input
                id="entry-start"
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  if (event.target.value > endDate) setEndDate(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="entry-end">{t("fields.endDate")}</FieldLabel>
              <Input
                id="entry-end"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="entry-note">{t("fields.note")}</FieldLabel>
            <Textarea
              id="entry-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          {kind === "sick" ? (
            <Field>
              <FieldLabel htmlFor="entry-reason">{t("fields.reason")}</FieldLabel>
              <Textarea
                id="entry-reason"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
              <FieldDescription>{t("reasonHint")}</FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button disabled={pending || employeeId === ""} onClick={submit}>
          {pending ? t("sending") : t("save")}
        </Button>
      </SheetFooter>
    </>
  );
}
