import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { zonedDate } from "@/lib/timezone";
import { listOrgHolidays } from "@/modules/attendance/payroll-queries";
import { HolidayList } from "./holiday-list";

// Holidays of a year: taken from the platform list (FBiH), dates editable,
// and per holiday whether it is non-working for nobody (default), everybody
// or the employees selected in the monthly overview.

export default function HolidaysPage({ searchParams }: PageProps<"/settings/holidays">) {
  return (
    <PageSuspense>
      <HolidaysContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function HolidaysContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("holidays"), getMemberAccess(member)]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  if (!access.permissions.has("shifts.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const params = await searchParams;
  const thisYear = Number(zonedDate(new Date(), member.organization.timezone).slice(0, 4));
  const year = z.coerce
    .number()
    .int()
    .min(2000)
    .max(2100)
    .catch(thisYear)
    .parse(firstParam(params.year) ?? thisYear);
  const list = await listOrgHolidays(member.organization.id, year);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap items-center gap-2">
        {[year - 1, year, year + 1].map((item) => (
          <Link
            key={item}
            href={`/settings/holidays?year=${item}`}
            aria-current={item === year ? "page" : undefined}
            className={buttonVariants({
              variant: item === year ? "secondary" : "ghost",
              size: "sm",
            })}
          >
            {item}
          </Link>
        ))}
      </div>
      <HolidayList year={year} holidays={list.holidays} scopes={list.scopes} />
    </>
  );
}
