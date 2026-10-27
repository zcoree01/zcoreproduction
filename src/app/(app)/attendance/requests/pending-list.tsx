"use client";

import { CheckIcon, FileTextIcon, InboxIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay, formatPeriod } from "@/lib/format";
import {
  absenceDocumentUrlAction,
  decideAbsenceAction,
  decideCorrectionAction,
  decideInterruptionAction,
} from "@/modules/attendance/absence-actions";
import type {
  PendingAbsence,
  PendingCorrection,
  PendingInterruption,
} from "@/modules/attendance/absence-queries";
import type { RequestActionResult } from "@/modules/attendance/absence-schemas";

type Correction = PendingCorrection & { proposed: string; original: string | null };

/**
 * Requests waiting for the caller: approve, or reject with a reason (the
 * reject button stays disabled until a reason is typed).
 */
export function PendingList({
  absences,
  interruptions,
  corrections,
}: {
  absences: PendingAbsence[];
  interruptions: PendingInterruption[];
  corrections: Correction[];
}) {
  const t = useTranslations("absences");
  if (absences.length === 0 && interruptions.length === 0 && corrections.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon />}
        title={t("pendingEmptyTitle")}
        description={t("pendingEmptyDescription")}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="pending-requests">
      {absences.map((absence) => (
        <Decision
          key={absence.id}
          testId="pending-absence"
          title={`${absence.employeeName} · ${t(`kinds.${absence.kind}`)}`}
          detail={`${formatPeriod(absence.startDate, absence.endDate, t("openEnded"))} · ${t("workingDays", { count: absence.workingDays })}`}
          note={absence.note}
          documentId={absence.hasDocument ? absence.id : null}
          decide={(approve, note) => decideAbsenceAction(absence.id, { approve, note })}
        />
      ))}
      {interruptions.map((item) => (
        <Decision
          key={`interruption-${item.id}`}
          testId="pending-interruption"
          title={`${item.employeeName} · ${t("interruption")}`}
          detail={t("interruptionDetail", {
            period: `${t(`kinds.${item.kind}`)} ${formatPeriod(item.startDate, item.endDate, "")}`,
            lastDay: formatDay(item.lastDay),
          })}
          note={item.note}
          documentId={null}
          decide={(approve, note) => decideInterruptionAction(item.id, { approve, note })}
        />
      ))}
      {corrections.map((correction) => (
        <Decision
          key={correction.id}
          testId="pending-correction"
          title={`${correction.employeeName} · ${t("correction")}`}
          detail={
            correction.original
              ? t("correctionChange", { from: correction.original, to: correction.proposed })
              : t("correctionAdd", { to: correction.proposed })
          }
          note={correction.reason}
          documentId={null}
          decide={(approve, note) => decideCorrectionAction(correction.id, { approve, note })}
        />
      ))}
    </ul>
  );
}

function Decision({
  title,
  detail,
  note,
  documentId,
  decide,
  testId,
}: {
  title: string;
  detail: string;
  note: string | null;
  documentId: string | null;
  decide: (approve: boolean, note: string) => Promise<RequestActionResult>;
  testId: string;
}) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [decisionNote, setDecisionNote] = useState("");
  const [pending, startTransition] = useTransition();
  const hasNote = decisionNote.trim() !== "";

  const run = (approve: boolean) =>
    startTransition(async () => {
      try {
        const result = await decide(approve, decisionNote);
        if (result.ok) {
          toast.success(t(approve ? "approvedToast" : "rejectedToast"));
          router.refresh();
        } else toast.error(t(`errors.${result.error}`));
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  const openDocument = () =>
    startTransition(async () => {
      if (!documentId) return;
      const result = await absenceDocumentUrlAction(documentId);
      if (result.ok) window.open(result.url, "_blank", "noopener");
      else toast.error(t("errors.document_hidden"));
    });

  return (
    <li
      className="flex flex-col gap-2 rounded-lg border p-3 lg:flex-row lg:items-center"
      data-testid={testId}
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground tabular-nums">{detail}</span>
        {note ? <span className="text-sm">{note}</span> : null}
        {documentId ? (
          <Button variant="link" size="sm" className="h-auto self-start p-0" onClick={openDocument}>
            <FileTextIcon />
            {t("openDocument")}
          </Button>
        ) : null}
      </div>
      <Input
        value={decisionNote}
        onChange={(event) => setDecisionNote(event.target.value)}
        placeholder={t("decisionPlaceholder")}
        aria-label={t("decisionPlaceholder")}
        maxLength={500}
        className="lg:w-64"
      />
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => run(true)}>
          <CheckIcon />
          {t("approve")}
        </Button>
        <Button
          variant="outline"
          disabled={pending || !hasNote}
          title={hasNote ? undefined : t("rejectNeedsNote")}
          onClick={() => run(false)}
        >
          <XIcon />
          {t("reject")}
        </Button>
      </div>
    </li>
  );
}
