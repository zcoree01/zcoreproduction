import { ClipboardCheckIcon, SearchIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { Duration } from "@/components/shared/duration";
import { EmptyState } from "@/components/shared/empty-state";
import { MachineStatusBadge } from "@/components/shared/machine-status-badge";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Badge } from "@/components/ui/badge";
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
import { formatDecimal } from "@/lib/decimal";
import { formatLocalDateTime } from "@/lib/format";
import { utcToZonedLocal, zonedDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { getProductionDay, listFloorMachines } from "@/modules/production-reporting/day";
import { daySummary, dayWorkers, filterDay } from "@/modules/production-reporting/day-rules";
import { LiveRefresh } from "./live-refresh";

// The foreman's live overview of one day: machines and who works where,
// open downtime, today's reports, downtime by reason and tool changes, with
// filters by machine, worker and order. Shifts come with their own module.

export default function ProductionDayPage({ searchParams }: PageProps<"/production">) {
  return (
    <PageSuspense>
      <ProductionDayContent searchParams={searchParams} />
    </PageSuspense>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

async function ProductionDayContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const timeZone = member.organization.timezone;
  const [t, access] = await Promise.all([
    getTranslations("productionDay"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("orders.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const params = await searchParams;
  const today = zonedDate(new Date(), timeZone);
  const date = z.iso
    .date()
    .catch(today)
    .parse(firstParam(params.date) ?? today);
  const filters = {
    machine: z
      .uuid()
      .nullable()
      .catch(null)
      .parse(firstParam(params.machine) || null),
    worker: z
      .uuid()
      .nullable()
      .catch(null)
      .parse(firstParam(params.worker) || null),
    order: z
      .string()
      .trim()
      .max(100)
      .catch("")
      .parse(firstParam(params.order) ?? ""),
  };

  const [fullDay, machines] = await Promise.all([
    getProductionDay(organizationId, date, timeZone),
    access.permissions.has("machines.read")
      ? listFloorMachines(organizationId)
      : Promise.resolve([]),
  ]);
  if (!fullDay) return <PermissionDenied description={t("deniedDescription")} />;
  const day = filterDay(fullDay, filters);
  const summary = daySummary(day);
  const workers = dayWorkers(fullDay);
  const shownMachines = filters.machine
    ? machines.filter((machine) => machine.id === filters.machine)
    : machines;
  const openDowntime = day.downtime.filter((row) => row.endedAt === null);
  const time = (iso: string) => formatLocalDateTime(utcToZonedLocal(iso, timeZone));
  const filtered = filters.machine !== null || filters.worker !== null || filters.order !== "";
  const orderLink = (id: string, number: string) => (
    <Link
      href={`/orders/${id}?tab=production`}
      className="font-mono font-medium underline-offset-4 hover:underline"
    >
      {number}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<LiveRefresh active={date === today} />}
      />

      <form action="/production" role="search" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.date")}
          <Input name="date" type="date" defaultValue={date} className="w-40" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.machine")}
          <NativeSelect name="machine" defaultValue={filters.machine ?? ""}>
            <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
            {machines.map((machine) => (
              <NativeSelectOption key={machine.id} value={machine.id}>
                {machine.code}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.worker")}
          <NativeSelect name="worker" defaultValue={filters.worker ?? ""}>
            <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
            {workers.map((worker) => (
              <NativeSelectOption key={worker.id} value={worker.id}>
                {worker.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-48 flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.order")}
          <Input
            name="order"
            type="search"
            defaultValue={filters.order}
            placeholder={t("filters.orderPlaceholder")}
          />
        </label>
        <Button type="submit">
          <SearchIcon />
          {t("filters.apply")}
        </Button>
        {filtered || date !== today ? (
          <Link href="/production" className={cn(buttonVariants({ variant: "ghost" }))}>
            {t("filters.reset")}
          </Link>
        ) : null}
      </form>

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="day-summary">
        <Stat label={t("stats.good")}>{formatDecimal(summary.good)}</Stat>
        <Stat label={t("stats.scrap")}>{formatDecimal(summary.scrap)}</Stat>
        <Stat label={t("stats.scrapRate")}>
          {summary.scrapRate === null ? "—" : `${formatDecimal(summary.scrapRate)} %`}
        </Stat>
        <Stat label={t("stats.downtime")}>
          {summary.downtimeSeconds === "0" ? "—" : <Duration seconds={summary.downtimeSeconds} />}
        </Stat>
        <Stat label={t("stats.openDowntime")}>{summary.openDowntime}</Stat>
        <Stat label={t("stats.toolChanges")}>{summary.toolChanges}</Stat>
      </dl>

      {shownMachines.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t("machinesTitle")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {shownMachines.map((machine) => {
              const working = day.working.filter((row) => row.machineId === machine.id);
              const stop = openDowntime.find((row) => row.machineId === machine.id);
              return (
                <li key={machine.id}>
                  <Card size="sm" data-testid={`day-machine-${machine.code}`}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="font-mono">{machine.code}</span>{" "}
                          <span className="font-normal text-muted-foreground">{machine.name}</span>
                        </span>
                        <MachineStatusBadge status={machine.status} />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-1 text-sm">
                      {working.length === 0 && !stop ? (
                        <span className="text-muted-foreground">{t("machineIdle")}</span>
                      ) : null}
                      {working.map((row) => (
                        <span key={`${row.employeeId}-${row.orderId}`}>
                          {orderLink(row.orderId, row.orderNumber)} · {row.operationCode} ·{" "}
                          {row.employeeName}{" "}
                          <span className="text-xs text-muted-foreground">
                            {t("since", { time: time(row.startedAt) })}
                          </span>
                        </span>
                      ))}
                      {stop ? (
                        <span className="text-destructive">
                          {t("stoppedFor", { reason: stop.reason, time: time(stop.startedAt) })}
                        </span>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {openDowntime.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="day-open-downtime">
          <h2 className="text-base font-semibold">{t("openDowntimeTitle")}</h2>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.since")}</TableHead>
                  <TableHead>{t("columns.machine")}</TableHead>
                  <TableHead>{t("columns.order")}</TableHead>
                  <TableHead>{t("columns.reason")}</TableHead>
                  <TableHead>{t("columns.worker")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openDowntime.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{time(row.startedAt)}</TableCell>
                    <TableCell className="font-mono">{row.machineCode ?? "—"}</TableCell>
                    <TableCell>
                      {orderLink(row.orderId, row.orderNumber)} · {row.operationCode}
                    </TableCell>
                    <TableCell>{row.reason}</TableCell>
                    <TableCell>{row.employeeName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("reportsTitle")}</h2>
        {day.reports.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheckIcon />}
            title={t("reportsEmptyTitle")}
            description={t("reportsEmptyDescription")}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table data-testid="day-reports">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.time")}</TableHead>
                  <TableHead>{t("columns.machine")}</TableHead>
                  <TableHead>{t("columns.order")}</TableHead>
                  <TableHead>{t("columns.worker")}</TableHead>
                  <TableHead className="text-right">{t("columns.good")}</TableHead>
                  <TableHead className="text-right">{t("columns.scrap")}</TableHead>
                  <TableHead>{t("columns.scrapReason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {day.reports.map((row) => (
                  <TableRow
                    key={row.id}
                    className={row.voided ? "text-muted-foreground line-through" : undefined}
                  >
                    <TableCell className="whitespace-nowrap">{time(row.at)}</TableCell>
                    <TableCell className="font-mono">{row.machineCode ?? "—"}</TableCell>
                    <TableCell>
                      {orderLink(row.orderId, row.orderNumber)} · {row.operationCode}
                    </TableCell>
                    <TableCell>{row.employeeName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDecimal(row.good)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDecimal(row.scrap)}
                    </TableCell>
                    <TableCell>{row.scrapReason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t("byReasonTitle")}</h2>
          {summary.downtimeByReason.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDowntime")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="day-downtime-by-reason">
              {summary.downtimeByReason.map((row) => (
                <li
                  key={row.reason}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span>{row.reason}</span>
                  <span className="text-muted-foreground tabular-nums">
                    <Duration seconds={row.seconds} /> · {t("times", { count: row.count })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t("toolChangesTitle")}</h2>
          {day.toolChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noToolChanges")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {day.toolChanges.map((row) => (
                <li key={row.id} className="flex flex-col rounded-lg border px-3 py-2">
                  <span>
                    <span className="font-medium">{row.tool}</span>
                    {row.insert ? (
                      <span className="text-muted-foreground"> · {row.insert}</span>
                    ) : null}{" "}
                    <Badge variant="outline">{row.reason}</Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {time(row.at)} · {row.machineCode ?? "—"} · {row.orderNumber} ·{" "}
                    {row.operationCode} · {row.employeeName ?? "—"}
                    {row.minutes ? ` · ${formatDecimal(row.minutes)} min` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
