import { CalendarClockIcon, CalendarDaysIcon, UserXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDay, formatLocalDateTime } from "@/lib/format";
import { utcToZonedLocal, zonedDate } from "@/lib/timezone";
import { getMyRequests } from "@/modules/attendance/absence-queries";
import { leaveBalance } from "@/modules/attendance/leave-rules";
import { effectiveRates, formatMoney, hoursLabel } from "@/modules/attendance/month-rules";
import { monthTotals } from "@/modules/attendance/pay-rules";
import { getCalcSettings, getMyPayInputs } from "@/modules/attendance/payroll-queries";
import { getMyAttendance } from "@/modules/attendance/queries";
import { addDays, dateRange, isoWeekday, mondayOf } from "@/modules/attendance/schedule-rules";
import { getMySchedule } from "@/modules/attendance/schedule-queries";
import {
  formatMinutes,
  monthRange,
  sessionTime,
  totalTime,
  type AttendanceSession,
} from "@/modules/attendance/rules";
import { ClockButton } from "./clock-button";
import { CorrectionButton, RequestsPanel } from "./requests-panel";

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
  const year = Number(today.slice(0, 4));
  const weekAgo = addDays(today, -7);
  // Weekly overtime needs the whole first week of the month.
  const firstWeek = mondayOf(month.from);
  const [mine, planned, tSchedule, requests, calc, payInputs] = await Promise.all([
    getMyAttendance(member.organization.id, weekAgo < firstWeek ? weekAgo : firstWeek, month.to),
    getMySchedule(member.organization.id, today, addDays(today, 13)),
    getTranslations("schedule"),
    getMyRequests(member.organization.id, year),
    getCalcSettings(member.organization.id),
    getMyPayInputs(member.organization.id, firstWeek, month.to),
  ]);
  if (!mine || !requests) {
    return (
      <EmptyState
        icon={<UserXIcon />}
        title={t("noEmployeeTitle")}
        description={t("noEmployeeDescription")}
      />
    );
  }

  const time = (iso: string) => utcToZonedLocal(iso, timeZone).slice(11);
  const local = (iso: string) => utcToZonedLocal(iso, timeZone);
  const open = mine.open;
  // The last 7 days, newest first: each closed session can be corrected.
  const recentSessions = mine.sessions
    .filter((session) => session.workDate >= weekAgo || session.id === open?.id)
    .reverse();
  const totals = totalTime(
    mine.sessions.filter((session) => session.workDate >= month.from),
    now,
  );
  // Net pay so far (hours × own rate or the default, plus premiums).
  const pay = payInputs
    ? monthTotals(
        mine.sessions,
        calc,
        { weekendDays: payInputs.weekendDays, holidays: new Set(payInputs.holidays) },
        effectiveRates(payInputs.rates, payInputs.defaultRate),
        month,
        timeZone,
        now,
      )
    : null;
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
          <CardTitle className="text-base">{t("recentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {recentSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("recentEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recentSessions.map((session) => (
                <SessionLine
                  key={session.id}
                  session={session}
                  now={now}
                  time={time}
                  t={t}
                  day={session.workDate === today ? null : formatDay(session.workDate)}
                  correction={
                    session.clockOutAt ? (
                      <CorrectionButton
                        label="fix"
                        target={{
                          sessionId: session.id,
                          clockIn: local(session.clockInAt),
                          clockOut: local(session.clockOutAt),
                        }}
                      />
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
          <CorrectionButton
            label="add"
            target={{ sessionId: null, clockIn: `${today}T06:00`, clockOut: `${today}T14:00` }}
          />
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
            <Figure label={t("regular")}>
              {formatMinutes(pay ? pay.regularMin : totals.regularMinutes)}
            </Figure>
            <Figure label={t("overtime")}>
              {formatMinutes(pay ? pay.overtimeMin : totals.overtimeMinutes)}
            </Figure>
            <Figure label={t("days")}>{pay ? pay.days : totals.days}</Figure>
          </dl>
          {pay ? (
            <dl className="mt-2 grid grid-cols-3 gap-2" data-testid="month-premiums">
              <Figure label={t("night")}>{hoursLabel(pay.nightMin)}</Figure>
              <Figure label={t("weekend")}>{hoursLabel(pay.weekendMin)}</Figure>
              <Figure label={t("holiday")}>{hoursLabel(pay.holidayMin)}</Figure>
            </dl>
          ) : null}
          {pay?.pay ? (
            <div className="mt-2 rounded-lg border p-3 text-center" data-testid="month-pay">
              <div className="text-xs text-muted-foreground">{t("paySoFar")}</div>
              <div className="text-3xl font-semibold tabular-nums">{formatMoney(pay.pay)} KM</div>
              <div className="text-xs text-muted-foreground">{t("payNote")}</div>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">{t("monthNote")}</p>
        </CardContent>
      </Card>

      <RequestsPanel
        today={today}
        year={year}
        balance={leaveBalance(year, requests.leave.rules, requests.leave.data)}
        absences={requests.absences}
        corrections={requests.corrections.map((correction) => ({
          ...correction,
          clockIn: formatLocalDateTime(local(correction.clockInAt)),
          clockOut: formatLocalDateTime(local(correction.clockOutAt)),
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDaysIcon className="size-4" aria-hidden />
            {t("scheduleTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {planned.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("scheduleEmpty")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="my-schedule">
              {dateRange(today, addDays(today, 13)).map((day) => {
                const entry = planned.find((item) => item.date === day);
                return (
                  <li key={day} className="flex items-center justify-between gap-2 py-2">
                    <span className="tabular-nums">
                      {tSchedule(`weekdays.${isoWeekday(day)}`)} {formatDay(day)}
                    </span>
                    {entry ? (
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {entry.code}
                        </Badge>
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {entry.startsAt}–{entry.endsAt}
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">{tSchedule("dayOff")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
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
  day,
  correction,
}: {
  session: AttendanceSession;
  now: Date;
  time: (iso: string) => string;
  t: Awaited<ReturnType<typeof getTranslations<"attendance">>>;
  /** Shown for days other than today. */
  day: string | null;
  correction: ReactNode;
}) {
  const worked = sessionTime(session, now);
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <span className="flex flex-wrap items-center gap-2 tabular-nums">
        {day ? <span className="text-sm text-muted-foreground">{day}</span> : null}
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
        {correction}
      </span>
    </li>
  );
}
