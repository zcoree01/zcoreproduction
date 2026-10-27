import { CalendarDaysIcon, ClockIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { zonedDate } from "@/lib/timezone";
import { listShifts } from "@/modules/attendance/queries";
import { dateRange, scheduleRange, shiftRange } from "@/modules/attendance/schedule-rules";
import { getScheduleRange, listCrews } from "@/modules/attendance/schedule-queries";
import { ScheduleGrid } from "./schedule-grid";

// Schedule grid (week or month): who works which shift on which day.
// Rotations fill it ("Primijeni rotacije"), the foreman changes single days
// by hand; manual days are never overwritten by a rotation.

export default function SchedulePage({ searchParams }: PageProps<"/attendance/schedule">) {
  return (
    <PageSuspense>
      <ScheduleContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function ScheduleContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("schedule"), getMemberAccess(member)]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  if (!access.permissions.has("attendance.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const params = await searchParams;
  const today = zonedDate(new Date(), member.organization.timezone);
  const view = z.enum(["week", "month"]).catch("week").parse(firstParam(params.view));
  const date = z.iso
    .date()
    .catch(today)
    .parse(firstParam(params.date) ?? today);
  const crew = z
    .uuid()
    .nullable()
    .catch(null)
    .parse(firstParam(params.crew) || null);
  const range = scheduleRange(view, date);

  const [rows, shifts, crews] = await Promise.all([
    getScheduleRange(organizationId, range.from, range.to),
    listShifts(organizationId),
    listCrews(organizationId),
  ]);
  if (!rows) return <PermissionDenied description={t("deniedDescription")} />;
  const activeShifts = shifts.filter((shift) => shift.archivedAt === null);
  const shown = crew ? rows.filter((row) => row.crewId === crew) : rows;
  const href = (next: { view?: string; date?: string; crew?: string | null }) => {
    const query = new URLSearchParams({
      view: next.view ?? view,
      date: next.date ?? date,
    });
    const crewParam = next.crew === undefined ? crew : next.crew;
    if (crewParam) query.set("crew", crewParam);
    return `/attendance/schedule?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/attendance/crews" className={buttonVariants({ variant: "outline" })}>
            {t("crewsLink")}
          </Link>
        }
      />
      {activeShifts.length === 0 ? (
        <EmptyState
          icon={<ClockIcon />}
          title={t("noShiftsTitle")}
          description={t("noShiftsDescription")}
          action={
            <Link href="/settings/shifts" className={buttonVariants()}>
              {t("noShiftsAction")}
            </Link>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<CalendarDaysIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : null}
      {activeShifts.length > 0 ? (
        <ScheduleGrid
          view={view}
          date={date}
          today={today}
          dates={dateRange(range.from, range.to)}
          rows={shown}
          shifts={activeShifts.map((shift) => ({
            id: shift.id,
            code: shift.code,
            name: shift.name,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            color: shift.color,
          }))}
          crews={crews
            .filter((item) => !item.archived)
            .map((item) => ({ id: item.id, name: item.name }))}
          crew={crew}
          canManage={access.permissions.has("attendance.manage")}
          links={{
            previous: href({ date: shiftRange(view, date, -1) }),
            next: href({ date: shiftRange(view, date, 1) }),
            today: href({ date: today }),
            week: href({ view: "week" }),
            month: href({ view: "month" }),
            crewBase: href({ crew: null }),
          }}
        />
      ) : null}
    </>
  );
}
