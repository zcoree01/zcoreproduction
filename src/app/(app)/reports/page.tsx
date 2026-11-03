import { DownloadIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { compareDecimals, divideDecimal, formatDecimal } from "@/lib/decimal";
import { formatDay, formatOneDecimal, formatShortDay } from "@/lib/format";
import { zonedDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  BASE_UNITS,
  displayUnit,
  toDisplayQuantity,
  type BaseUnit,
} from "@/modules/inventory/rules";
import { loadReport, type FilterOptions, type ReportData } from "@/modules/reports/report";
import { defaultPeriod, parseReportParams, reportQuery } from "@/modules/reports/params";
import { PRODUCTION_GROUPS, REPORT_TABS, type ReportFilters } from "@/modules/reports/schemas";

// Reports (D-043): production and efficiency, machines and downtime, orders
// and due dates, material / tools and order costs. reports.read; filters in
// the URL; the same figures go to the Excel export.

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <PageSuspense>
      <ReportsContent searchParams={searchParams} />
    </PageSuspense>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"reports">>>;

const hours = (seconds: number) => formatOneDecimal(seconds / 3600);
const money = (value: string) => formatDecimal(divideDecimal(value, "1", 2));
const qty = (value: string) => formatDecimal(divideDecimal(value, "1", 3));

async function ReportsContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("reports"), getMemberAccess(member)]);
  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("reports.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const today = zonedDate(new Date(), member.organization.timezone);
  const params = await searchParams;
  const parsed = parseReportParams(
    Object.fromEntries(Object.entries(params).map(([key, value]) => [key, firstParam(value)])),
    today,
  );
  const filters = parsed.filters;
  const data = await loadReport(member.organization.id, filters, today);
  const href = (next: Partial<ReportFilters>) => `/reports?${reportQuery({ ...filters, ...next })}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <a
            href={`/reports/export?${reportQuery(filters)}`}
            className={buttonVariants({ variant: "outline" })}
            download
          >
            <DownloadIcon />
            {t("export")}
          </a>
        }
      />
      <nav aria-label={t("title")} className="flex flex-wrap gap-1 border-b pb-2">
        {REPORT_TABS.map((tab) => (
          <Link
            key={tab}
            href={href({ tab })}
            aria-current={tab === filters.tab ? "page" : undefined}
            className={buttonVariants({
              variant: tab === filters.tab ? "secondary" : "ghost",
              size: "sm",
            })}
          >
            {t(`tabs.${tab}`)}
          </Link>
        ))}
      </nav>
      {parsed.invalid ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>{t("filters.invalid")}</AlertDescription>
        </Alert>
      ) : null}
      <FilterBar t={t} filters={filters} options={data.options} today={today} href={href} />
      <Report t={t} data={data} filters={filters} />
    </div>
  );
}

function FilterBar({
  t,
  filters,
  options,
  today,
  href,
}: {
  t: T;
  filters: ReportFilters;
  options: FilterOptions;
  today: string;
  href: (next: Partial<ReportFilters>) => string;
}) {
  const presets = [
    { key: "thisMonth" as const, ...defaultPeriod(today, "thisMonth") },
    { key: "lastMonth" as const, ...defaultPeriod(today, "lastMonth") },
    { key: "last30" as const, ...defaultPeriod(today, "last30") },
  ];
  const select = (
    name: "machine" | "employee" | "customer" | "order",
    list: { id: string; label: string }[],
  ) =>
    list.length === 0 && !filters[name] ? null : (
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t(`filters.${name}`)}
        <NativeSelect name={name} defaultValue={filters[name] ?? ""} className="min-w-40">
          <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
          {list.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
    );
  return (
    <form
      action="/reports"
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
      data-testid="report-filters"
    >
      <input type="hidden" name="tab" value={filters.tab} />
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("filters.from")}
        <Input type="date" name="from" defaultValue={filters.from} className="w-40" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("filters.to")}
        <Input type="date" name="to" defaultValue={filters.to} className="w-40" />
      </label>
      {filters.tab === "production" ? (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.group")}
          <NativeSelect name="group" defaultValue={filters.group}>
            {PRODUCTION_GROUPS.map((group) => (
              <NativeSelectOption key={group} value={group}>
                {t(`groups.${group}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      ) : null}
      {filters.tab === "production" || filters.tab === "machines"
        ? select("machine", options.machines)
        : null}
      {filters.tab === "production" ? select("employee", options.employees) : null}
      {filters.tab !== "machines" ? select("customer", options.customers) : null}
      {filters.tab !== "machines" ? select("order", options.orders) : null}
      <Button type="submit">{t("filters.apply")}</Button>
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <Link
            key={preset.key}
            href={href({
              from: preset.from,
              to: preset.to,
              machine: undefined,
              employee: undefined,
              customer: undefined,
              order: undefined,
            })}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t(`filters.${preset.key}`)}
          </Link>
        ))}
      </div>
    </form>
  );
}

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border p-3" title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function Empty({ t }: { t: T }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

const num = "text-right tabular-nums";

function Report({ t, data, filters }: { t: T; data: ReportData; filters: ReportFilters }) {
  switch (data.tab) {
    case "production":
      return <ProductionReport t={t} data={data} filters={filters} />;
    case "machines":
      return <MachineReport t={t} data={data} />;
    case "orders":
      return <OrderReport t={t} data={data} />;
    case "costs":
      return <CostReport t={t} data={data} />;
  }
}

function percent(t: T, value: number | string | null) {
  return value === null
    ? t("none")
    : t("percent", {
        value: typeof value === "number" ? formatOneDecimal(value) : formatDecimal(value),
      });
}

function ProductionReport({
  t,
  data,
  filters,
}: {
  t: T;
  data: Extract<ReportData, { tab: "production" }>;
  filters: ReportFilters;
}) {
  const total = data.total;
  const max = Math.max(...data.daily.map((day) => Number(day.good)), 0);
  const byWorker = filters.group === "employee";
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="report-totals">
        <Stat label={t("production.good")}>{formatDecimal(total?.good ?? "0")}</Stat>
        <Stat label={t("production.scrap")}>{formatDecimal(total?.scrap ?? "0")}</Stat>
        <Stat label={t("production.scrapRate")}>{percent(t, total?.scrapRate ?? null)}</Stat>
        <Stat label={t("production.time")}>
          {t("hours", { hours: hours(total?.seconds ?? 0) })}
        </Stat>
        <Stat label={t("production.efficiency")} hint={t("production.efficiencyHint")}>
          {percent(t, total?.efficiency ?? null)}
        </Stat>
        <Stat label={t("production.goodPerHour")}>
          {total?.goodPerHour !== null && total?.goodPerHour !== undefined
            ? formatOneDecimal(total.goodPerHour)
            : t("none")}
        </Stat>
      </dl>

      <Section title={t("production.daily")}>
        {max <= 0 ? (
          <Empty t={t} />
        ) : (
          <>
            <div
              className="flex h-40 items-end gap-0.5"
              role="img"
              aria-label={t("production.dailyAria")}
            >
              {data.daily.map((day) => {
                const value = Number(day.good);
                return (
                  <div
                    key={day.day}
                    className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                    title={t("production.dailyTip", {
                      day: formatShortDay(day.day),
                      good: formatDecimal(day.good),
                    })}
                  >
                    <div
                      className="rounded-t-sm bg-primary/80 group-hover:bg-primary"
                      style={{ height: `${value > 0 ? Math.max((value / max) * 100, 2) : 0}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{formatShortDay(data.daily[0]?.day ?? filters.from)}</span>
              <span>{formatShortDay(data.daily.at(-1)?.day ?? filters.to)}</span>
            </div>
            <table className="sr-only">
              <tbody>
                {data.daily.map((day) => (
                  <tr key={day.day}>
                    <td>{formatDay(day.day)}</td>
                    <td>{formatDecimal(day.good)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title={`${t("filters.group")}: ${t(`groups.${filters.group}`)}`}>
        <Hint>{byWorker ? t("production.workerTimeHint") : t("production.efficiencyHint")}</Hint>
        {data.rows.length === 0 ? (
          <Empty t={t} />
        ) : (
          <Table data-testid="report-production-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t(`groups.${filters.group}`)}</TableHead>
                <TableHead className={num}>{t("production.good")}</TableHead>
                <TableHead className={num}>{t("production.scrap")}</TableHead>
                <TableHead className={num}>{t("production.scrapRate")}</TableHead>
                <TableHead className={num}>
                  {byWorker ? t("production.timeWorker") : t("production.time")}
                </TableHead>
                <TableHead className={num}>{t("production.planned")}</TableHead>
                <TableHead className={num}>{t("production.efficiency")}</TableHead>
                <TableHead className={num}>{t("production.goodPerHour")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    {filters.group === "day"
                      ? formatDay(row.label)
                      : row.label || t(`missing.${filters.group}`)}
                  </TableCell>
                  <TableCell className={num}>{formatDecimal(row.good)}</TableCell>
                  <TableCell className={num}>{formatDecimal(row.scrap)}</TableCell>
                  <TableCell className={num}>{percent(t, row.scrapRate)}</TableCell>
                  <TableCell className={num}>{t("hours", { hours: hours(row.seconds) })}</TableCell>
                  <TableCell className={num}>
                    {t("hours", { hours: hours(row.plannedSeconds) })}
                  </TableCell>
                  <TableCell
                    className={cn(
                      num,
                      row.efficiency !== null && row.efficiency < 85 && "text-destructive",
                    )}
                  >
                    {percent(t, row.efficiency)}
                  </TableCell>
                  <TableCell className={num}>
                    {row.goodPerHour === null ? t("none") : formatOneDecimal(row.goodPerHour)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("production.scrapByReason")}>
          {data.scrap.length === 0 ? (
            <Empty t={t} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("production.reason")}</TableHead>
                  <TableHead className={num}>{t("production.scrap")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.scrap.map((row) => (
                  <TableRow key={row.reason}>
                    <TableCell>{row.reason || t("noReason")}</TableCell>
                    <TableCell className={num}>{formatDecimal(row.scrap)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
        <Section title={t("production.downtimeByReason")}>
          <DowntimeTable t={t} rows={data.downtime} />
        </Section>
      </div>
    </div>
  );
}

function DowntimeTable({ t, rows }: { t: T; rows: { reason: string; seconds: number }[] }) {
  const max = Math.max(...rows.map((row) => row.seconds), 0);
  if (rows.length === 0) return <Empty t={t} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("production.reason")}</TableHead>
          <TableHead className="w-1/3" />
          <TableHead className={num}>{t("production.totalTime")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.reason}>
            <TableCell>{row.reason}</TableCell>
            <TableCell>
              <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                <div
                  className="h-1.5 rounded-full bg-primary"
                  style={{ width: `${max > 0 ? (row.seconds / max) * 100 : 0}%` }}
                />
              </div>
            </TableCell>
            <TableCell className={num}>{t("hours", { hours: hours(row.seconds) })}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MachineReport({ t, data }: { t: T; data: Extract<ReportData, { tab: "machines" }> }) {
  const toolReasons = new Map<string, { changes: number; minutes: number }>();
  for (const row of data.toolChanges) {
    const current = toolReasons.get(row.reason) ?? { changes: 0, minutes: 0 };
    current.changes += row.changes;
    current.minutes += row.minutes;
    toolReasons.set(row.reason, current);
  }
  return (
    <div className="flex flex-col gap-4">
      <Section title={t("tabs.machines")}>
        <Hint>{t("machines.capacityHint")}</Hint>
        {data.machines.length === 0 ? (
          <Empty t={t} />
        ) : (
          <Table data-testid="report-machine-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("machines.machine")}</TableHead>
                <TableHead className={num}>{t("machines.capacity")}</TableHead>
                <TableHead className={num}>{t("machines.run")}</TableHead>
                <TableHead className={num}>{t("machines.downtime")}</TableHead>
                <TableHead className={num}>{t("machines.idle")}</TableHead>
                <TableHead className="w-48">{t("machines.utilization")}</TableHead>
                <TableHead className={num}>{t("machines.toolChanges")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.machines.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className={num}>
                    {t("hours", { hours: hours(row.capacitySeconds) })}
                  </TableCell>
                  <TableCell className={num}>
                    {t("hours", { hours: hours(row.runSeconds) })}
                  </TableCell>
                  <TableCell className={num}>
                    {t("hours", { hours: hours(row.downtimeSeconds) })}
                  </TableCell>
                  <TableCell className={num}>
                    {t("hours", { hours: hours(row.idleSeconds) })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-muted" aria-hidden>
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${Math.min(row.utilization ?? 0, 100)}%` }}
                        />
                      </div>
                      <span className="w-14 text-right tabular-nums">
                        {percent(t, row.utilization)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={num}>
                    {row.toolChanges > 0
                      ? `${row.toolChanges} · ${formatOneDecimal(row.toolChangeMinutes)} ${t("machines.toolMinutes")}`
                      : t("none")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("production.downtimeByReason")}>
          <DowntimeTable t={t} rows={data.downtime} />
        </Section>
        <Section title={t("machines.toolChangesTitle")}>
          {toolReasons.size === 0 ? (
            <Empty t={t} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("production.reason")}</TableHead>
                  <TableHead className={num}>{t("machines.changes")}</TableHead>
                  <TableHead className={num}>{t("machines.minutes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...toolReasons.entries()].map(([reason, row]) => (
                  <TableRow key={reason}>
                    <TableCell>{reason}</TableCell>
                    <TableCell className={num}>{row.changes}</TableCell>
                    <TableCell className={num}>{formatOneDecimal(row.minutes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}

function OrderReport({ t, data }: { t: T; data: Extract<ReportData, { tab: "orders" }> }) {
  const s = data.summary;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="report-totals">
        <Stat label={t("orders.completed")}>{s.completed}</Stat>
        <Stat label={t("orders.onTime")}>{percent(t, s.onTimePercent)}</Stat>
        <Stat label={t("orders.averageLate")}>
          {s.averageLateDays === null
            ? t("none")
            : t("orders.days", { days: formatOneDecimal(s.averageLateDays) })}
        </Stat>
        <Stat label={t("orders.openLate")}>{s.openLate}</Stat>
      </dl>
      <Section title={t("tabs.orders")}>
        <Hint>{t("orders.scope")}</Hint>
        {data.rows.length === 0 ? (
          <Empty t={t} />
        ) : (
          <Table data-testid="report-order-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("orders.order")}</TableHead>
                <TableHead>{t("orders.customer")}</TableHead>
                <TableHead>{t("orders.product")}</TableHead>
                <TableHead className={num}>{t("orders.good")}</TableHead>
                <TableHead>{t("orders.due")}</TableHead>
                <TableHead>{t("orders.completedOn")}</TableHead>
                <TableHead>{t("orders.state")}</TableHead>
                <TableHead className={num}>{t("orders.plannedTime")}</TableHead>
                <TableHead className={num}>{t("orders.runTime")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/orders/${row.id}`} className="font-medium hover:underline">
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell>{row.customer ?? t("noCustomer")}</TableCell>
                  <TableCell className="max-w-56 truncate">
                    {row.part_number} {row.product}
                  </TableCell>
                  <TableCell className={num}>
                    {formatDecimal(row.good)} / {formatDecimal(row.quantity)}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDay(row.due_date)}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.completed_on ? formatDay(row.completed_on) : t("orders.open")}
                  </TableCell>
                  <TableCell className={cn(row.lateDays > 0 && "text-destructive")}>
                    {row.lateDays > 0
                      ? t("orders.lateLabel", { days: row.lateDays })
                      : t("orders.onTimeLabel")}
                  </TableCell>
                  <TableCell className={num}>
                    {t("hours", { hours: hours(row.planned_seconds) })}
                  </TableCell>
                  <TableCell className={num}>
                    {t("hours", { hours: hours(row.run_seconds) })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title={t("orders.byCustomer")}>
        {data.customers.length === 0 ? (
          <Empty t={t} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("orders.customer")}</TableHead>
                <TableHead className={num}>{t("orders.customerCompleted")}</TableHead>
                <TableHead className={num}>{t("orders.customerLate")}</TableHead>
                <TableHead className={num}>{t("orders.onTime")}</TableHead>
                <TableHead className={num}>{t("orders.customerLateDays")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.customers.map((row) => (
                <TableRow key={row.name || "-"}>
                  <TableCell>{row.name || t("noCustomer")}</TableCell>
                  <TableCell className={num}>{row.completed}</TableCell>
                  <TableCell className={num}>{row.late}</TableCell>
                  <TableCell className={num}>
                    {percent(t, ((row.completed - row.late) / row.completed) * 100)}
                  </TableCell>
                  <TableCell className={num}>{row.lateDays}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}

function CostReport({ t, data }: { t: T; data: Extract<ReportData, { tab: "costs" }> }) {
  const km = (value: string) => t("costs.km", { value: money(value) });
  return (
    <div className="flex flex-col gap-4">
      <Section title={t("costs.title")}>
        <Hint>{t("costs.hint")}</Hint>
        {data.rows.length === 0 ? (
          <Empty t={t} />
        ) : (
          <Table data-testid="report-cost-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("orders.order")}</TableHead>
                <TableHead>{t("orders.customer")}</TableHead>
                <TableHead className={num}>{t("orders.good")}</TableHead>
                <TableHead className={num}>{t("costs.material")}</TableHead>
                <TableHead className={num}>{t("costs.machine")}</TableHead>
                <TableHead className={num}>{t("costs.external")}</TableHead>
                <TableHead className={num}>{t("costs.total")}</TableHead>
                <TableHead className={num}>{t("costs.perPiece")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/orders/${row.id}`} className="font-medium hover:underline">
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell>{row.customer ?? t("noCustomer")}</TableCell>
                  <TableCell className={num}>{formatDecimal(row.good)}</TableCell>
                  <TableCell className={num}>{km(row.material_cost)}</TableCell>
                  <TableCell className={num}>
                    <span className="inline-flex items-center gap-1">
                      {row.rate_missing ? (
                        <TriangleAlertIcon
                          className="size-3.5 text-amber-600"
                          aria-label={t("costs.rateMissing")}
                        >
                          <title>{t("costs.rateMissing")}</title>
                        </TriangleAlertIcon>
                      ) : null}
                      {km(row.machine_cost)}
                    </span>
                  </TableCell>
                  <TableCell className={num}>{km(row.external_cost)}</TableCell>
                  <TableCell className={cn(num, "font-medium")}>{km(row.totalCost)}</TableCell>
                  <TableCell className={num}>
                    {row.costPerPiece === null ? t("none") : km(row.costPerPiece)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell colSpan={6}>{t("costs.total")}</TableCell>
                <TableCell className={num}>{km(data.summary.totalCost)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
        {data.rows.some((row) => row.rate_missing) ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t("costs.rateMissing")}</p>
        ) : null}
      </Section>

      <Section title={t("costs.materialTitle")}>
        <MaterialTable t={t} rows={data.material} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("costs.stockTitle")}>
          <p className="text-sm font-medium" data-testid="report-stock-total">
            {t("costs.stockTotal", { value: money(data.stock.total) })}
          </p>
          <MaterialTable t={t} rows={data.stock.rows.slice(0, 50)} />
        </Section>
        <Section title={t("costs.toolsTitle")}>
          {data.tools.length === 0 ? (
            <Empty t={t} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("costs.tool")}</TableHead>
                  <TableHead className={num}>{t("costs.consumed")}</TableHead>
                  <TableHead className={num}>{t("costs.scrapped")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tools.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell>
                      {row.code} · {row.name}
                    </TableCell>
                    <TableCell className={num}>
                      {t("costs.pieces", { count: row.consumed })}
                    </TableCell>
                    <TableCell className={num}>
                      {t("costs.pieces", { count: row.scrapped })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}

const isBaseUnit = (unit: string): unit is BaseUnit =>
  (BASE_UNITS as readonly string[]).includes(unit);

/** Quantity in the item's display unit (length in metres). */
function amount(unit: string, quantity: string): string {
  if (!isBaseUnit(unit)) return `${qty(quantity)} ${unit}`;
  const shown = displayUnit(unit);
  return `${qty(toDisplayQuantity(unit, quantity))} ${shown === "m2" ? "m²" : shown === "pcs" ? "kom" : shown}`;
}

function MaterialTable({
  t,
  rows,
}: {
  t: T;
  rows: {
    itemId: string;
    label: string;
    unit: string;
    quantity: string;
    massKg: string;
    value: string;
  }[];
}) {
  if (rows.length === 0) return <Empty t={t} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("costs.item")}</TableHead>
          <TableHead className={num}>{t("costs.quantity")}</TableHead>
          <TableHead className={num}>{t("costs.mass")}</TableHead>
          <TableHead className={num}>{t("costs.value")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.itemId}>
            <TableCell>{row.label}</TableCell>
            <TableCell className={num}>{amount(row.unit, row.quantity)}</TableCell>
            <TableCell className={num}>
              {compareDecimals(row.massKg, "0") === 0 ? t("none") : qty(row.massKg)}
            </TableCell>
            <TableCell className={num}>{t("costs.km", { value: money(row.value) })}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
