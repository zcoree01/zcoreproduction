"use client";

import { CameraIcon, PalmtreeIcon, PencilIcon, ThermometerIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDay } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  attachAbsenceDocumentAction,
  cancelMyAbsenceAction,
  cancelMyCorrectionAction,
  prepareAbsenceDocumentAction,
  requestAbsenceAction,
  requestCorrectionAction,
} from "@/modules/attendance/absence-actions";
import type { MyAbsence, MyCorrection } from "@/modules/attendance/absence-queries";
import {
  ABSENCE_DOCUMENT_MAX_BYTES,
  ABSENCE_DOCUMENT_TYPES,
  ABSENCE_KINDS,
  type AbsenceKind,
  type RequestActionResult,
  type RequestStatus,
} from "@/modules/attendance/absence-schemas";
import type { LeaveBalance } from "@/modules/attendance/leave-rules";

const STATUS_TONES: Record<RequestStatus, StatusTone> = {
  requested: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

type CorrectionTarget = { sessionId: string | null; clockIn: string; clockOut: string };

type Props = {
  today: string;
  year: number;
  balance: LeaveBalance;
  absences: MyAbsence[];
  corrections: (MyCorrection & { clockIn: string; clockOut: string })[];
};

const LEAVE_KINDS = ABSENCE_KINDS.filter((kind) => kind !== "sick");

function isDocumentType(type: string): type is keyof typeof ABSENCE_DOCUMENT_TYPES {
  return type in ABSENCE_DOCUMENT_TYPES;
}

/**
 * The worker's requests on the phone: leave and absences, sick leave with a
 * photo of the sick note, corrections of clock-in / clock-out, the leave
 * balance and the status of every request. Each form keeps its idempotency
 * key until the server confirms (no double requests on a weak connection).
 */
export function RequestsPanel(props: Props) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [sheet, setSheet] = useState<"leave" | "sick" | null>(null);
  const [, startTransition] = useTransition();

  const cancel = (action: () => Promise<RequestActionResult>) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          toast.success(t("cancelledToast"));
          router.refresh();
        } else toast.error(t(`errors.${result.error}`));
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PalmtreeIcon className="size-4" aria-hidden />
            {t("balanceTitle", { year: props.year })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-2 text-center" data-testid="leave-balance">
            <div className="rounded-lg border p-2">
              <dt className="text-xs text-muted-foreground">{t("entitlement")}</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {props.balance.entitlement + props.balance.carriedOver}
              </dd>
            </div>
            <div className="rounded-lg border p-2">
              <dt className="text-xs text-muted-foreground">{t("used")}</dt>
              <dd className="text-xl font-semibold tabular-nums">{props.balance.used}</dd>
            </div>
            <div className="rounded-lg border p-2">
              <dt className="text-xs text-muted-foreground">{t("available")}</dt>
              <dd className="text-xl font-semibold tabular-nums">{props.balance.available}</dd>
            </div>
          </dl>
          {props.balance.carriedOver > 0 || props.balance.pending > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("balanceNote", {
                carried: props.balance.carriedOver,
                pending: props.balance.pending,
              })}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="outline" className="h-14" onClick={() => setSheet("leave")}>
              <PalmtreeIcon />
              {t("requestLeave")}
            </Button>
            <Button size="lg" variant="outline" className="h-14" onClick={() => setSheet("sick")}>
              <ThermometerIcon />
              {t("reportSick")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("myRequestsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {props.absences.length === 0 && props.corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("myRequestsEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="my-requests">
              {props.absences.map((absence) => (
                <li key={absence.id} className="flex flex-col gap-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t(`kinds.${absence.kind}`)}</span>
                    <StatusBadge tone={STATUS_TONES[absence.status]}>
                      {t(`statuses.${absence.status}`)}
                    </StatusBadge>
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDay(absence.startDate)}
                    {absence.endDate !== absence.startDate
                      ? ` – ${formatDay(absence.endDate)}`
                      : ""}
                    {" · "}
                    {t("workingDays", { count: absence.workingDays })}
                    {absence.hasDocument ? ` · ${t("documentAttached")}` : ""}
                  </span>
                  {absence.decisionNote ? (
                    <span className="text-sm">
                      {t("decisionNote", { note: absence.decisionNote })}
                    </span>
                  ) : null}
                  {absence.status === "requested" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => cancel(() => cancelMyAbsenceAction(absence.id))}
                    >
                      <XIcon />
                      {t("withdraw")}
                    </Button>
                  ) : null}
                </li>
              ))}
              {props.corrections.map((correction) => (
                <li key={correction.id} className="flex flex-col gap-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t("correction")}</span>
                    <StatusBadge tone={STATUS_TONES[correction.status]}>
                      {t(`statuses.${correction.status}`)}
                    </StatusBadge>
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {correction.clockIn} – {correction.clockOut}
                  </span>
                  <span className="text-sm">{correction.reason}</span>
                  {correction.decisionNote ? (
                    <span className="text-sm">
                      {t("decisionNote", { note: correction.decisionNote })}
                    </span>
                  ) : null}
                  {correction.status === "requested" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => cancel(() => cancelMyCorrectionAction(correction.id))}
                    >
                      <XIcon />
                      {t("withdraw")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col gap-0">
          {sheet !== null ? (
            <AbsenceForm
              key={sheet}
              sick={sheet === "sick"}
              today={props.today}
              onDone={() => {
                setSheet(null);
                router.refresh();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function AbsenceForm({
  sick,
  today,
  onDone,
}: {
  sick: boolean;
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("absences");
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<AbsenceKind>(sick ? "sick" : "vacation");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Kept until the server confirms: a resend never creates a second request.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [savedId, setSavedId] = useState<string | null>(null);

  const uploadDocument = async (absenceId: string, document: File): Promise<boolean> => {
    if (!isDocumentType(document.type) || document.size > ABSENCE_DOCUMENT_MAX_BYTES) {
      toast.error(t("errors.document_invalid"));
      return false;
    }
    const meta = {
      absenceId,
      fileName: document.name || "doznaka",
      contentType: document.type,
      size: document.size,
    };
    const ticket = await prepareAbsenceDocumentAction(meta);
    if (!ticket.ok) {
      toast.error(t(`errors.${ticket.error}`));
      return false;
    }
    const upload = await createClient()
      .storage.from("absence-documents")
      .uploadToSignedUrl(ticket.path, ticket.token, document, { contentType: document.type });
    if (upload.error) {
      toast.error(t("errors.upload_failed"));
      return false;
    }
    const attached = await attachAbsenceDocumentAction(meta, ticket.path);
    if (!attached.ok) {
      toast.error(t(`errors.${attached.error}`));
      return false;
    }
    return true;
  };

  const submit = () =>
    startTransition(async () => {
      try {
        let absenceId = savedId;
        if (!absenceId) {
          const result = await requestAbsenceAction({
            kind,
            startDate,
            endDate,
            note,
            reason: sick ? reason : "",
            idempotencyKey,
          });
          if (!result.ok) {
            toast.error(t(`errors.${result.error}`));
            return;
          }
          absenceId = result.id ?? null;
          setSavedId(absenceId);
        }
        if (absenceId && file && !(await uploadDocument(absenceId, file))) return;
        toast.success(t(sick ? "sickSentToast" : "leaveSentToast"));
        onDone();
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{sick ? t("sickTitle") : t("leaveRequestTitle")}</SheetTitle>
        <SheetDescription>
          {sick ? t("sickDescription") : t("leaveRequestDescription")}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {!sick ? (
            <Field>
              <FieldLabel htmlFor="absence-kind">{t("fields.kind")}</FieldLabel>
              <NativeSelect
                id="absence-kind"
                className="h-12 w-full"
                value={kind}
                onChange={(event) => {
                  const next = LEAVE_KINDS.find((item) => item === event.target.value);
                  if (next) setKind(next);
                }}
              >
                {LEAVE_KINDS.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {t(`kinds.${item}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="absence-start">{t("fields.startDate")}</FieldLabel>
              <Input
                id="absence-start"
                type="date"
                className="h-12"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  if (event.target.value > endDate) setEndDate(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="absence-end">{t("fields.endDate")}</FieldLabel>
              <Input
                id="absence-end"
                type="date"
                className="h-12"
                min={startDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="absence-note">{t("fields.note")}</FieldLabel>
            <Textarea
              id="absence-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          {sick ? (
            <>
              <Field>
                <FieldLabel htmlFor="absence-reason">{t("fields.reason")}</FieldLabel>
                <Textarea
                  id="absence-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
                <FieldDescription>{t("reasonHint")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="absence-document">{t("fields.document")}</FieldLabel>
                <label
                  htmlFor="absence-document"
                  className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-sm"
                >
                  <CameraIcon className="size-5" aria-hidden />
                  {file ? file.name : t("takePhoto")}
                </label>
                <input
                  id="absence-document"
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <FieldDescription>{t("documentHint")}</FieldDescription>
              </Field>
            </>
          ) : null}
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button size="lg" className="h-12" disabled={pending} onClick={submit}>
          {pending ? t("sending") : t("send")}
        </Button>
      </SheetFooter>
    </>
  );
}

/** "Ispravi" on a session line, or "Dodaj zaboravljeni dolazak". */
export function CorrectionButton({
  target,
  label,
}: {
  target: CorrectionTarget;
  label: "fix" | "add";
}) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={label === "fix" ? "ghost" : "outline"}
        size={label === "fix" ? "icon-sm" : "lg"}
        className={label === "add" ? "h-12 w-full" : undefined}
        aria-label={label === "fix" ? t("fixSession") : undefined}
        onClick={() => setOpen(true)}
      >
        <PencilIcon />
        {label === "add" ? t("addMissing") : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col gap-0">
          {open ? (
            <CorrectionForm
              target={target}
              onDone={() => {
                setOpen(false);
                router.refresh();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function CorrectionForm({ target, onDone }: { target: CorrectionTarget; onDone: () => void }) {
  const t = useTranslations("absences");
  const [pending, startTransition] = useTransition();
  const [clockIn, setClockIn] = useState(target.clockIn);
  const [clockOut, setClockOut] = useState(target.clockOut);
  const [reason, setReason] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const submit = () =>
    startTransition(async () => {
      try {
        const result = await requestCorrectionAction({
          sessionId: target.sessionId ?? "",
          clockIn,
          clockOut,
          reason,
          idempotencyKey,
        });
        if (!result.ok) {
          toast.error(t(`errors.${result.error}`));
          return;
        }
        toast.success(t("correctionSentToast"));
        onDone();
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{target.sessionId ? t("correctionTitle") : t("addMissingTitle")}</SheetTitle>
        <SheetDescription>{t("correctionDescription")}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="correction-in">{t("fields.clockIn")}</FieldLabel>
            <Input
              id="correction-in"
              type="datetime-local"
              className="h-12"
              value={clockIn}
              onChange={(event) => setClockIn(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="correction-out">{t("fields.clockOut")}</FieldLabel>
            <Input
              id="correction-out"
              type="datetime-local"
              className="h-12"
              value={clockOut}
              onChange={(event) => setClockOut(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="correction-reason">{t("fields.correctionReason")}</FieldLabel>
            <Textarea
              id="correction-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button
          size="lg"
          className="h-12"
          disabled={pending || reason.trim() === ""}
          onClick={submit}
        >
          {pending ? t("sending") : t("send")}
        </Button>
      </SheetFooter>
    </>
  );
}
