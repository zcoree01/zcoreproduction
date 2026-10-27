import { UsersIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { formatLocalDateTime } from "@/lib/format";
import { utcToZonedLocal, zonedDate, zonedLocalToUtc } from "@/lib/timezone";
import { getAttendanceBoard, listAttendanceAlerts } from "@/modules/attendance/queries";
import {
  boardCounts,
  boardRows,
  formatMinutes,
  sessionTime,
  type BoardStatus,
} from "@/modules/attendance/rules";
import { LiveRefresh } from "../production/live-refresh";
import { AlertList } from "./alert-list";
import { CorrectionEntry } from "./correction-entry";

// The foreman's attendance board for one day: who is in now, who is late or
// absent, who has left, plus alerts (automatic clock-outs and clock-ins) to
// check with the worker. Presence is shown separately from time on
// operations (Pregled proizvodnje).

export default function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  return (
    <PageSuspense>
      <AttendanceContent searchParams={searchParams} />
    </PageSuspense>
  );
}

const STATUS_TONES: Record<BoardStatus, StatusTone> = {
  present: "success",
  left: "neutral",
  late: "warning",
  absent: "danger",
  expected: "info",
  on_leave: "info",
  off: "neutral",
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

async function AttendanceContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const timeZone = member.organization.timezone;
  const [t, access] = await Promise.all([
    getTranslations("attendanceBoard"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  if (!access.permissions.has("attendance.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const params = await searchParams;
  const now = new Date();
  const today = zonedDate(now, timeZone);
  const date = z.iso
    .date()
    .catch(today)
    .parse(firstParam(params.date) ?? today);
  const showOff = firstParam(params.all) === "1";

  const [board, alerts] = await Promise.all([
    getAttendanceBoard(organizationId, date),
    access.permissions.has("attendance.manage")
      ? listAttendanceAlerts(organizationId)
      : Promise.resolve([]),
  ]);
  if (!board) return <PermissionDenied description={t("deniedDescription")} />;

  // For another day "now" is the end of that day, so nobody is "expected".
  const reference = date === today ? now : new Date(zonedLocalToUtc(`${date}T23:59`, timeZone));
  const rows = boardRows(board.employees, board.rules, reference);
  const counts = boardCounts(rows);
  const shown = showOff ? rows : rows.filter((row) => row.status !== "off");
  const time = (iso: string) => utcToZonedLocal(iso, timeZone).slice(11);
  const local = (iso: string) => utcToZonedLocal(iso, timeZone);
  const canCorrect = access.permissions.has("attendance.manage");

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<LiveRefresh active={date === today} />}
      />

      <form action="/attendance" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("date")}
          <Input name="date" type="date" defaultValue={date} className="w-40" />
        </label>
        {showOff ? <input type="hidden" name="all" value="1" /> : null}
        <Button type="submit" variant="outline">
          {t("show")}
        </Button>
        {date !== today ? (
          <Link href="/attendance" className={buttonVariants({ variant: "ghost" })}>
            {t("today")}
          </Link>
        ) : null}
      </form>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {(["present", "late", "absent", "expected", "left", "on_leave", "off"] as const).map(
          (status) => (
            <Stat key={status} label={t(`status.${status}`)}>
              {counts[status]}
            </Stat>
          ),
        )}
      </dl>

      {alerts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("alertsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("alertsDescription")}</p>
          <AlertList
            alerts={alerts.map((alert) => ({
              ...alert,
              clockIn: formatLocalDateTime(utcToZonedLocal(alert.clockInAt, timeZone)),
              clockOut: alert.clockOutAt
                ? formatLocalDateTime(utcToZonedLocal(alert.clockOutAt, timeZone))
                : null,
            }))}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("employeesTitle")}</h2>
          <Link
            href={`/attendance?date=${date}${showOff ? "" : "&all=1"}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {showOff ? t("hideOff") : t("showOff", { count: counts.off })}
          </Link>
        </div>
        {shown.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.employee")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.shift")}</TableHead>
                  <TableHead>{t("columns.in")}</TableHead>
                  <TableHead>{t("columns.out")}</TableHead>
                  <TableHead className="text-right">{t("columns.present")}</TableHead>
                  <TableHead className="text-right">{t("columns.regular")}</TableHead>
                  <TableHead className="text-right">{t("columns.overtime")}</TableHead>
                  {canCorrect ? (
                    <TableHead>
                      <span className="sr-only">{t("columns.actions")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => {
                  const totals = row.sessions.map((session) => sessionTime(session, now));
                  const sum = (key: "presentMinutes" | "regularMinutes" | "overtimeMinutes") =>
                    totals.reduce((total, item) => total + item[key], 0);
                  const first = row.sessions[0];
                  const last = row.sessions.at(-1);
                  const shift = row.current?.shiftCode ?? row.scheduled?.code ?? null;
                  return (
                    <TableRow key={row.id} data-testid="attendance-row">
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground">
                          #{row.number}
                          {row.department ? ` · ${row.department}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge tone={STATUS_TONES[row.status]}>
                            {t(`status.${row.status}`)}
                          </StatusBadge>
                          {row.status === "late" ? (
                            <span className="text-xs text-muted-foreground">
                              {t("minutes", { minutes: row.lateMinutes })}
                            </span>
                          ) : null}
                          {row.arrivedLate ? (
                            <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                              {t("arrivedLate", { minutes: row.lateMinutes })}
                            </Badge>
                          ) : null}
                          {row.sessions.some((session) => session.clockOutSource === "auto") ? (
                            <Badge variant="secondary">{t("autoClosed")}</Badge>
                          ) : null}
                          {row.sessions.some((session) => session.clockInSource === "operation") ? (
                            <Badge variant="secondary">{t("autoClockIn")}</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {shift ? (
                          <Badge variant="outline" className="font-mono">
                            {shift}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {first ? time(first.clockInAt) : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {last?.clockOutAt ? time(last.clockOutAt) : last ? t("stillIn") : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.sessions.length > 0 ? formatMinutes(sum("presentMinutes")) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {row.sessions.length > 0 ? formatMinutes(sum("regularMinutes")) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.sessions.length > 0 ? formatMinutes(sum("overtimeMinutes")) : "—"}
                      </TableCell>
                      {canCorrect ? (
                        <TableCell>
                          <CorrectionEntry
                            employeeId={row.id}
                            employeeName={row.name}
                            defaultDay={date}
                            sessions={row.sessions.map((session) => ({
                              id: session.id,
                              clockIn: local(session.clockInAt),
                              clockOut: session.clockOutAt ? local(session.clockOutAt) : null,
                              label: `${time(session.clockInAt)} – ${
                                session.clockOutAt ? time(session.clockOutAt) : t("stillIn")
                              }`,
                            }))}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("presenceNote")}</p>
      </section>
    </>
  );
}
