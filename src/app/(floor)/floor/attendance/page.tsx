import { CalendarClockIcon, UserXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDay } from "@/lib/format";
import { utcToZonedLocal, zonedDate } from "@/lib/timezone";
import { getMyAttendance } from "@/modules/attendance/queries";
import {
  formatMinutes,
  monthRange,
  sessionTime,
  totalTime,
  type AttendanceSession,
} from "@/modules/attendance/rules";
import { ClockButton } from "./clock-button";

// The worker's attendance on the phone: one big clock-in / clock-out button,
// today's shift and sessions, and this month's hours. The server records the
// time and recognises the shift.

export default function FloorAttendancePage() {
  return (
    <PageSuspense>
      <FloorAttendanceContent />
    </PageSuspense>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

async function FloorAttendanceContent() {
  const member = await requireMember();
  const timeZone = member.organization.timezone;
  const [t, access] = await Promise.all([getTranslations("attendance"), getMemberAccess(member)]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;

  const now = new Date();
  const today = zonedDate(now, timeZone);
  const month = monthRange(today);
  const mine = await getMyAttendance(member.organization.id, month.from, month.to);
  if (!mine) {
    return (
      <EmptyState
        icon={<UserXIcon />}
        title={t("noEmployeeTitle")}
        description={t("noEmployeeDescription")}
      />
    );
  }

  const time = (iso: string) => utcToZonedLocal(iso, timeZone).slice(11);
  const open = mine.open;
  const todaySessions = mine.sessions.filter(
    (session) => session.workDate === today || session.id === open?.id,
  );
  const totals = totalTime(mine.sessions, now);
  const shift = open?.shiftCode
    ? {
        code: open.shiftCode,
        name: open.shiftName ?? "",
        from: open.scheduledStart ? time(open.scheduledStart) : null,
        to: open.scheduledEnd ? time(open.scheduledEnd) : null,
      }
    : mine.expectedShift
      ? {
          code: mine.expectedShift.code,
          name: mine.expectedShift.name,
          from: time(mine.expectedShift.scheduledStart),
          to: time(mine.expectedShift.scheduledEnd),
        }
      : mine.todayShift
        ? {
            code: mine.todayShift.code,
            name: mine.todayShift.name,
            from: mine.todayShift.startsAt,
            to: mine.todayShift.endsAt,
          }
        : null;
  const openTime = open ? sessionTime(open, now) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{formatDay(today)}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold" data-testid="attendance-state">
                {open ? t("inSince", { time: time(open.clockInAt) }) : t("notIn")}
              </p>
              {openTime && openTime.lateMinutes > 0 ? (
                <p className="text-sm text-destructive">
                  {t("lateBy", { minutes: openTime.lateMinutes })}
                </p>
              ) : null}
              {open?.clockInSource === "operation" ? (
                <p className="text-sm text-muted-foreground">{t("autoClockInNote")}</p>
              ) : null}
            </div>
            {shift ? (
              <div className="flex flex-col items-end gap-1 text-right">
                <Badge variant="outline" className="font-mono">
                  {shift.code}
                </Badge>
                <span className="text-sm">{shift.name}</span>
                {shift.from && shift.to ? (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {shift.from}–{shift.to}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">{t("noShift")}</span>
            )}
          </div>
          <ClockButton direction={open ? "out" : "in"} />
          <p className="text-center text-xs text-muted-foreground">{t("serverTimeNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("todayTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {todaySessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("todayEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {todaySessions.map((session) => (
                <SessionLine key={session.id} session={session} now={now} time={time} t={t} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClockIcon className="size-4" aria-hidden />
            {t("monthTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-2">
            <Figure label={t("regular")}>{formatMinutes(totals.regularMinutes)}</Figure>
            <Figure label={t("overtime")}>{formatMinutes(totals.overtimeMinutes)}</Figure>
            <Figure label={t("days")}>{totals.days}</Figure>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t("monthNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SessionLine({
  session,
  now,
  time,
  t,
}: {
  session: AttendanceSession;
  now: Date;
  time: (iso: string) => string;
  t: Awaited<ReturnType<typeof getTranslations<"attendance">>>;
}) {
  const worked = sessionTime(session, now);
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <span className="flex items-center gap-2 tabular-nums">
        {session.shiftCode ? (
          <Badge variant="outline" className="font-mono">
            {session.shiftCode}
          </Badge>
        ) : null}
        {time(session.clockInAt)} – {session.clockOutAt ? time(session.clockOutAt) : t("now")}
      </span>
      <span className="flex items-center gap-2">
        {session.clockOutSource === "auto" ? (
          <Badge variant="secondary">{t("autoClosed")}</Badge>
        ) : null}
        <span className="font-medium tabular-nums">{formatMinutes(worked.regularMinutes)}</span>
      </span>
    </li>
  );
}
