import { CalendarOffIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { formatLocalDateTime } from "@/lib/format";
import { utcToZonedLocal, zonedDate } from "@/lib/timezone";
import {
  getLeaveOverview,
  listAbsences,
  listPendingRequests,
} from "@/modules/attendance/absence-queries";
import { leaveBalance } from "@/modules/attendance/leave-rules";
import { monthRange } from "@/modules/attendance/rules";
import { listScheduleEmployees } from "@/modules/attendance/schedule-queries";
import { AbsenceEntryButton, AbsenceTable } from "./absence-table";
import { LeaveTable } from "./leave-table";
import { PendingList } from "./pending-list";

// Absences and requests: requests waiting for the caller's decision (leave,
// sick leave, corrections), absences of a month, leave balances of a year
// and entering an absence. Sick-leave reasons and documents only with
// absences.sensitive.read.

export default function RequestsPage({ searchParams }: PageProps<"/attendance/requests">) {
  return (
    <PageSuspense>
      <RequestsContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function RequestsContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const timeZone = member.organization.timezone;
  const [t, access] = await Promise.all([getTranslations("absences"), getMemberAccess(member)]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  const canRead = access.permissions.has("absences.read");
  const canManageAbsences = access.permissions.has("absences.manage");
  const canManageAttendance = access.permissions.has("attendance.manage");
  if (!canRead && !canManageAttendance) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const params = await searchParams;
  const today = zonedDate(new Date(), timeZone);
  const month = z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .catch(today.slice(0, 7))
    .parse(firstParam(params.month) ?? today.slice(0, 7));
  const range = monthRange(`${month}-01`);
  const year = Number(month.slice(0, 4));

  const [pending, absences, leave, employees] = await Promise.all([
    listPendingRequests(organizationId),
    canRead ? listAbsences(organizationId, range.from, range.to) : Promise.resolve([]),
    canRead ? getLeaveOverview(organizationId, year) : Promise.resolve([]),
    canManageAbsences ? listScheduleEmployees(organizationId) : Promise.resolve([]),
  ]);
  const local = (iso: string | null) =>
    iso ? formatLocalDateTime(utcToZonedLocal(iso, timeZone)) : null;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManageAbsences ? <AbsenceEntryButton employees={employees} today={today} /> : null
        }
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("pendingTitle")}</h2>
        <PendingList
          absences={pending.absences}
          corrections={pending.corrections.map((correction) => ({
            ...correction,
            proposed: `${local(correction.clockInAt)} – ${local(correction.clockOutAt)}`,
            original:
              correction.originalIn !== null
                ? `${local(correction.originalIn)} – ${local(correction.originalOut) ?? "…"}`
                : null,
          }))}
        />
      </section>

      {canRead ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("monthTitle")}</h2>
            <form action="/attendance/requests" className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("month")}
                <Input name="month" type="month" defaultValue={month} className="w-44" />
              </label>
              <Button type="submit" variant="outline">
                {t("show")}
              </Button>
              {month !== today.slice(0, 7) ? (
                <Link href="/attendance/requests" className={buttonVariants({ variant: "ghost" })}>
                  {t("thisMonth")}
                </Link>
              ) : null}
            </form>
          </div>
          {absences && absences.length > 0 ? (
            <AbsenceTable
              absences={absences}
              canManage={canManageAbsences}
              sensitive={access.permissions.has("absences.sensitive.read")}
            />
          ) : (
            <EmptyState
              icon={<CalendarOffIcon />}
              title={t("monthEmptyTitle")}
              description={t("monthEmptyDescription")}
            />
          )}
        </section>
      ) : null}

      {canRead && leave ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("leaveTitle", { year })}</h2>
          <p className="text-sm text-muted-foreground">{t("leaveDescription")}</p>
          <LeaveTable
            year={year}
            canManage={canManageAbsences}
            rows={leave.map((row) => ({
              id: row.id,
              number: row.number,
              name: row.name,
              data: row.leave.data,
              balance: leaveBalance(year, row.leave.rules, row.leave.data),
            }))}
          />
        </section>
      ) : null}
    </>
  );
}
