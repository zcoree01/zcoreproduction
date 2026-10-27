import { AlertTriangleIcon, DownloadIcon, FileTextIcon, UsersIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { addDecimals } from "@/lib/decimal";
import { formatDay } from "@/lib/format";
import { zonedDate } from "@/lib/timezone";
import { ABSENCE_KINDS } from "@/modules/attendance/absence-schemas";
import { getMonthOverview } from "@/modules/attendance/month-overview";
import { formatMoney, hoursLabel } from "@/modules/attendance/month-rules";
import { listSelectableHolidays } from "@/modules/attendance/payroll-queries";
import { EmployeeSettingsButton } from "./employee-settings";

// Monthly overview per employee: worked, regular and overtime hours, night,
// weekend and holiday hours, absence days and net pay (payroll.read). Exports
// for payroll (Excel / CSV) and the header of the "Specifikacija uz isplatu
// plaće".

export default function MonthlyPage({ searchParams }: PageProps<"/attendance/monthly">) {
  return (
    <PageSuspense>
      <MonthlyContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function MonthlyContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const timeZone = member.organization.timezone;
  const [t, tAbsences, access] = await Promise.all([
    getTranslations("monthly"),
    getTranslations("absences"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  if (!access.permissions.has("attendance.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const params = await searchParams;
  const now = new Date();
  const today = zonedDate(now, timeZone);
  const month = z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .catch(today.slice(0, 7))
    .parse(firstParam(params.month) ?? today.slice(0, 7));
  const [overview, selectableHolidays] = await Promise.all([
    getMonthOverview(organizationId, month, timeZone, today, now),
    listSelectableHolidays(organizationId),
  ]);
  if (!overview) return <PermissionDenied description={t("deniedDescription")} />;
  const canManage = access.permissions.has("attendance.manage");
  const canPay = access.permissions.has("payroll.manage");
  const shown = overview.rows.filter(
    (row) =>
      row.totals.workedMin > 0 ||
      Object.keys(row.absenceDays).length > 0 ||
      firstParam(params.all) === "1",
  );
  const sum = (
    key: "workedMin" | "regularMin" | "overtimeMin" | "nightMin" | "weekendMin" | "holidayMin",
  ) => shown.reduce((total, row) => total + row.totals[key], 0);
  const payTotal = addDecimals(shown.flatMap((row) => (row.totals.pay ? [row.totals.pay] : [])));
  const query = `month=${month}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={`/attendance/monthly/export?${query}&format=xlsx`}
              className={buttonVariants({ variant: "outline" })}
            >
              <DownloadIcon />
              {t("exportExcel")}
            </a>
            <a
              href={`/attendance/monthly/export?${query}&format=csv`}
              className={buttonVariants({ variant: "outline" })}
            >
              <DownloadIcon />
              {t("exportCsv")}
            </a>
            <Link
              href={`/attendance/specification?${query}`}
              className={buttonVariants({ variant: "outline" })}
            >
              <FileTextIcon />
              {t("specification")}
            </Link>
          </div>
        }
      />

      <form action="/attendance/monthly" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("month")}
          <Input name="month" type="month" defaultValue={month} className="w-44" />
        </label>
        <Button type="submit" variant="outline">
          {t("show")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("rulesSummary", {
            mode: overview.settings.overtimeMode,
            weekly: overview.settings.weeklyHours,
            step: overview.settings.overtimeStepMin,
            night: `${overview.settings.nightStart}–${overview.settings.nightEnd}`,
          })}
        </span>
      </form>

      {shown.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="monthly-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.employee")}</TableHead>
                <TableHead className="text-right">{t("columns.days")}</TableHead>
                <TableHead className="text-right">{t("columns.worked")}</TableHead>
                <TableHead className="text-right">{t("columns.regular")}</TableHead>
                <TableHead className="text-right">{t("columns.overtime")}</TableHead>
                <TableHead className="text-right">{t("columns.night")}</TableHead>
                <TableHead className="text-right">{t("columns.weekend")}</TableHead>
                <TableHead className="text-right">{t("columns.holiday")}</TableHead>
                <TableHead>{t("columns.absences")}</TableHead>
                {overview.withPay ? (
                  <TableHead className="text-right">{t("columns.pay")}</TableHead>
                ) : null}
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">{t("columns.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.employee.id} data-testid="monthly-row">
                  <TableCell>
                    <div className="font-medium">{row.employee.name}</div>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      #{row.employee.number}
                      {row.employee.ownWeekend ? (
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          {t("ownWeekend")}
                        </Badge>
                      ) : null}
                      {row.totals.overtimeWarnings.length > 0 ? (
                        <span
                          className="flex items-center gap-1 text-amber-700 dark:text-amber-300"
                          title={row.totals.overtimeWarnings
                            .map((week) => formatDay(week))
                            .join(", ")}
                        >
                          <AlertTriangleIcon className="size-3" aria-hidden />
                          {t("overtimeWarning", {
                            count: row.totals.overtimeWarnings.length,
                            hours: overview.settings.weeklyOvertimeWarningHours,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.totals.days}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {hoursLabel(row.totals.workedMin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {hoursLabel(row.totals.regularMin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {hoursLabel(row.totals.overtimeMin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {hoursLabel(row.totals.nightMin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {hoursLabel(row.totals.weekendMin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {hoursLabel(row.totals.holidayMin)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ABSENCE_KINDS.filter((kind) => row.absenceDays[kind])
                      .map((kind) => `${t(`absenceShort.${kind}`)} ${row.absenceDays[kind]}`)
                      .join(" · ") || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  {overview.withPay ? (
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.totals.pay ? `${formatMoney(row.totals.pay)} KM` : "—"}
                      {row.totals.unpricedSessions > 0 ? (
                        <div className="text-xs text-amber-700 dark:text-amber-300">
                          {t("noRate")}
                        </div>
                      ) : null}
                    </TableCell>
                  ) : null}
                  {canManage ? (
                    <TableCell>
                      <EmployeeSettingsButton
                        employeeId={row.employee.id}
                        employeeName={row.employee.name}
                        ownWeekend={row.employee.ownWeekend}
                        weekendDays={row.employee.weekendDays}
                        orgWeekendDays={overview.settings.weekendDays}
                        holidayKeys={row.employee.holidayKeys}
                        selectableHolidays={selectableHolidays}
                        rates={canPay ? row.employee.rates : null}
                        today={today}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t("total")}</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold tabular-nums">
                  {hoursLabel(sum("workedMin"))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hoursLabel(sum("regularMin"))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hoursLabel(sum("overtimeMin"))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hoursLabel(sum("nightMin"))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hoursLabel(sum("weekendMin"))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hoursLabel(sum("holidayMin"))}
                </TableCell>
                <TableCell />
                {overview.withPay ? (
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMoney(payTotal)} KM
                  </TableCell>
                ) : null}
                {canManage ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t("note", {
          kinds: ABSENCE_KINDS.map(
            (kind) => `${t(`absenceShort.${kind}`)} = ${tAbsences(`kinds.${kind}`)}`,
          ).join(", "),
        })}
      </p>
      {firstParam(params.all) === "1" ? null : (
        <Link
          href={`/attendance/monthly?${query}&all=1`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("showAll")}
        </Link>
      )}
    </>
  );
}
