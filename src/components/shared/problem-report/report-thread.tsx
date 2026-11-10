"use client";

import { ArrowLeftIcon, ImageIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  getProblemReportThreadAction,
  replyProblemReportAction,
} from "@/modules/support/problem-reports/actions";
import { MAX_DESCRIPTION } from "@/modules/support/problem-reports/schemas";
import type {
  MyProblemReport,
  ReportSession,
  ReportThread as Thread,
} from "@/modules/support/problem-reports/types";
import type { SupportStatus } from "@/modules/support/schemas";

const SESSION_TONES: Record<SupportStatus, StatusTone> = {
  pending: "warning",
  approved: "info",
  active: "success",
  rejected: "danger",
  ended: "neutral",
  cancelled: "neutral",
};

/** One report: what was reported, the conversation, proposed sessions, a reply box. */
export function ReportThread({
  report,
  onBack,
  onOpened,
  onChanged,
}: {
  report: MyProblemReport;
  onBack: () => void;
  /** The conversation was shown: its notices count as read. */
  onOpened: (reportId: string) => void;
  /** The reporter answered: the list and the state change. */
  onChanged: () => void;
}) {
  const t = useTranslations("problemReports");
  const format = useFormatter();
  const [thread, setThread] = useState<Thread | null>(null);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await getProblemReportThreadAction(report.id);
        if (!active) return;
        setThread(next);
        setFailed(next === null);
        if (next) onOpened(report.id);
      } catch {
        if (active) setFailed(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [report.id, reloads, onOpened]);

  const reply = async () => {
    setPending(true);
    try {
      let result: Awaited<ReturnType<typeof replyProblemReportAction>>;
      try {
        result = await replyProblemReportAction({ reportId: report.id, body });
      } catch {
        toast.error(t("errors.offline"));
        return;
      }
      if (!result.ok) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      setBody("");
      setReloads((count) => count + 1);
      onChanged();
    } finally {
      setPending(false);
    }
  };

  const when = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-4" data-testid="report-thread">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 md:h-8"
          onClick={onBack}
        >
          <ArrowLeftIcon />
          {t("back")}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {t(`statuses.${report.status}`)}
        </span>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t(`categories.${report.category}`)}</span>
          <span className="ml-auto text-xs text-muted-foreground">{when(report.createdAt)}</span>
        </div>
        {report.description ? (
          <p className="text-sm whitespace-pre-wrap">{report.description}</p>
        ) : null}
        {thread && thread.fileCount > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ImageIcon className="size-3.5" />
            {t("files", { count: thread.fileCount })}
          </p>
        ) : null}
      </div>

      {failed ? <p className="text-sm text-destructive">{t("errors.load")}</p> : null}
      {thread === null && !failed ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : null}

      {thread?.sessions.map((session) => (
        <SessionCard key={session.id} session={session} when={when} />
      ))}

      {thread?.messages.map((message) => (
        <div
          key={message.id}
          className={
            message.fromZcore
              ? "flex flex-col gap-1 rounded-lg bg-muted p-3"
              : "flex flex-col gap-1 rounded-lg border p-3"
          }
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {message.fromZcore ? t("fromZcore") : t("fromYou")}
            </span>
            <span className="ml-auto">{when(message.createdAt)}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{message.body}</p>
        </div>
      ))}

      {thread ? (
        <div className="flex flex-col gap-2">
          <Field>
            <FieldLabel htmlFor="report-reply">{t("reply")}</FieldLabel>
            <Textarea
              id="report-reply"
              rows={3}
              maxLength={MAX_DESCRIPTION}
              value={body}
              disabled={pending}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          <Button
            type="button"
            size="lg"
            className="h-12 text-base"
            disabled={pending || body.trim() === ""}
            onClick={reply}
          >
            {t("sendReply")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SessionCard({
  session,
  when,
}: {
  session: ReportSession;
  when: (value: string) => string;
}) {
  const t = useTranslations("problemReports");
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-dashed p-3"
      data-testid="report-session"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t("session.title")}</span>
        <StatusBadge tone={SESSION_TONES[session.status]}>
          {t(`session.status.${session.status}`)}
        </StatusBadge>
      </div>
      {session.scheduledStart && session.durationMinutes ? (
        <p className="text-sm">
          {t("session.when", {
            start: when(session.scheduledStart),
            minutes: session.durationMinutes,
          })}
        </p>
      ) : null}
      {session.status === "pending" ? (
        <p className="text-xs text-muted-foreground">{t("session.pendingHint")}</p>
      ) : null}
    </div>
  );
}
