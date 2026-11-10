"use client";

import { SendIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  replyPlatformReportAction,
  setReportStatusAction,
} from "@/modules/platform/reports-actions";
import type { PlatformReportDetail } from "@/modules/platform/reports-queries";
import { PROBLEM_STATUSES, type ProblemStatus } from "@/modules/support/problem-reports/schemas";
import { ReportStatusBadge, SessionStatusBadge } from "./report-badges";
import { ScheduleSessionDialog } from "./schedule-session-dialog";

const KEEP = "keep";

/** One report: context, screenshots, conversation, reply with state, proposed sessions. */
export function ReportDetail({
  report,
  canManage,
  canSchedule,
}: {
  report: PlatformReportDetail;
  canManage: boolean;
  canSchedule: boolean;
}) {
  const t = useTranslations("platformReports.detail");
  const tCategories = useTranslations("problemReports.categories");
  const tStatuses = useTranslations("platformReports.statuses");
  const tSupport = useTranslations("support");
  const format = useFormatter();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [nextStatus, setNextStatus] = useState<string>(KEEP);
  const [pending, startTransition] = useTransition();

  const when = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Sarajevo",
    });

  const reply = () =>
    startTransition(async () => {
      const result = await replyPlatformReportAction({
        reportId: report.id,
        body,
        status: nextStatus === KEEP ? null : nextStatus,
      });
      if (result.ok) {
        toast.success(t("replied"));
        setBody("");
        setNextStatus(KEEP);
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  const changeStatus = (status: ProblemStatus) =>
    startTransition(async () => {
      const result = await setReportStatusAction({ reportId: report.id, status });
      if (result.ok) {
        toast.success(t("statusChanged"));
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  const context: [string, string][] = [
    [t("organization"), report.organization.name],
    [t("author"), report.authorName],
    [t("page"), report.pagePath ?? "—"],
    [t("device"), report.userAgent ?? "—"],
    [t("time"), when(report.createdAt)],
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-3">
            <CardTitle className="text-base">{tCategories(report.category)}</CardTitle>
            <ReportStatusBadge status={report.status} />
            {canManage ? (
              <div className="ml-auto flex items-center gap-2">
                <label htmlFor="report-status" className="text-sm text-muted-foreground">
                  {t("status")}
                </label>
                <NativeSelect
                  id="report-status"
                  size="sm"
                  value={report.status}
                  disabled={pending}
                  onChange={(event) => changeStatus(event.target.value as ProblemStatus)}
                >
                  {PROBLEM_STATUSES.map((status) => (
                    <NativeSelectOption key={status} value={status}>
                      {tStatuses(status)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {report.description ? (
              <p className="text-sm whitespace-pre-wrap">{report.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noDescription")}</p>
            )}
            {report.files.length > 0 ? (
              <div className="flex flex-wrap gap-3" data-testid="report-files">
                {report.files.map((file) =>
                  file.url ? (
                    <a key={file.id} href={file.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      <img
                        src={file.url}
                        alt={t("screenshot")}
                        className="max-h-48 rounded-md border"
                      />
                    </a>
                  ) : (
                    <span key={file.id} className="text-xs text-muted-foreground">
                      {t("screenshotUnavailable")}
                    </span>
                  ),
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("conversation")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3" data-testid="report-messages">
              {report.messages.length === 0 ? (
                <li className="text-sm text-muted-foreground">{t("noMessages")}</li>
              ) : null}
              {report.messages.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.fromZcore
                      ? "ml-8 rounded-lg border bg-muted/40 p-3"
                      : "mr-8 rounded-lg border p-3"
                  }
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {message.fromZcore
                        ? t("fromZcore", { name: message.authorName })
                        : message.authorName}
                    </span>
                    <span className="ml-auto">{when(message.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{message.body}</p>
                </li>
              ))}
            </ul>
            {canManage ? (
              <div className="flex flex-col gap-3">
                <Field>
                  <FieldLabel htmlFor="platform-reply">{t("reply")}</FieldLabel>
                  <Textarea
                    id="platform-reply"
                    rows={3}
                    maxLength={4000}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <label htmlFor="reply-status" className="text-sm text-muted-foreground">
                    {t("afterReply")}
                  </label>
                  <NativeSelect
                    id="reply-status"
                    size="sm"
                    value={nextStatus}
                    onChange={(event) => setNextStatus(event.target.value)}
                  >
                    <NativeSelectOption value={KEEP}>{t("keepStatus")}</NativeSelectOption>
                    {PROBLEM_STATUSES.map((status) => (
                      <NativeSelectOption key={status} value={status}>
                        {tStatuses(status)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button disabled={pending || body.trim() === ""} onClick={reply}>
                    <SendIcon />
                    {t("sendReply")}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("context")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              {context.map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
            </dl>
            <Link
              href={`/platform/organizations/${report.organization.id}`}
              className="mt-3 inline-block text-sm underline-offset-4 hover:underline"
            >
              {t("openOrganization")}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">{t("sessions")}</CardTitle>
            {canSchedule ? <ScheduleSessionDialog reportId={report.id} /> : null}
          </CardHeader>
          <CardContent>
            {report.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noSessions")}</p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="report-sessions">
                {report.sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <SessionStatusBadge status={session.status} />
                      {session.durationMinutes ? (
                        <span className="text-xs text-muted-foreground">
                          {tSupport("minutes", { minutes: session.durationMinutes })}
                        </span>
                      ) : null}
                    </div>
                    {session.scheduledStart ? <span>{when(session.scheduledStart)}</span> : null}
                    <span className="text-muted-foreground">{session.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
