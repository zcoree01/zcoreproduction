import { getTranslations } from "next-intl/server";
import { getOrgFormatter } from "@/i18n/org-formatter";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Duration } from "@/components/shared/duration";
import { MachineStatusBadge } from "@/components/shared/machine-status-badge";
import { DueWarningBadge, OrderStatusBadge, PriorityBadge } from "@/components/shared/order-badges";
import { OrderProgress } from "@/components/shared/order-progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { addDecimals, compareDecimals, divideDecimal, formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { boardCounts, boardRows } from "@/modules/attendance/rules";
import {
  dailyOutput,
  lastDays,
  ordersOverview,
  scrapByReason,
  seriesMax,
} from "@/modules/dashboard/stats";
import type { LayoutWidget, WidgetKey } from "@/modules/dashboard/widgets";
import { listDeliveryNotes, listFinishedStock } from "@/modules/finished-goods/queries";
import {
  countPendingAdjustments,
  countSubmittedStockCounts,
  listOrderShortages,
} from "@/modules/inventory/queries";
import { displayUnit, toDisplayQuantity, type BaseUnit } from "@/modules/inventory/rules";
import { dayRange, listFloorMachines } from "@/modules/production-reporting/day";
import { daySummary } from "@/modules/production-reporting/day-rules";
import { listPendingCloseRequests } from "@/modules/production-reporting/queries";
import { downtimeByReason } from "@/modules/production-reporting/rules";
import { listTools } from "@/modules/tools/queries";
import {
  loadAttendanceToday,
  loadOpenOrders,
  loadPendingRequests,
  loadProductionPeriod,
  loadProductionToday,
  loadStockItems,
  today,
} from "./data";

// Dashboard widgets (D-037). Each one loads its own data inside Suspense, so
// a slow widget never holds up the others. Who may see which widget is
// decided before rendering (visibleWidgets).

const SHOWN = 8;

type Context = { organizationId: string; timeZone: string };

export function DashboardGrid({ widgets, context }: { widgets: LayoutWidget[]; context: Context }) {
  return (
    <div className="grid grid-flow-row-dense gap-4 md:grid-cols-2 xl:grid-cols-3">
      {widgets.map((widget) => (
        <div
          key={widget.key}
          className={cn(widget.size === "wide" && "md:col-span-2")}
          data-widget={widget.key}
        >
          <Suspense fallback={<WidgetSkeleton />}>
            <Widget widgetKey={widget.key} context={context} />
          </Suspense>
        </div>
      ))}
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <Card className="h-full">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

async function Frame({
  widgetKey,
  href,
  children,
}: {
  widgetKey: WidgetKey;
  href?: string;
  children: ReactNode;
}) {
  const t = await getTranslations("dashboard");
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">{t(`widgets.${widgetKey}.title`)}</CardTitle>
        {href ? (
          <CardAction>
            <Link href={href} className="text-sm text-muted-foreground hover:underline">
              {t("open")}
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">{children}</CardContent>
    </Card>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

async function More({ count }: { count: number }) {
  if (count <= SHOWN) return null;
  const t = await getTranslations("dashboard");
  return <li className="text-muted-foreground">{t("more", { count: count - SHOWN })}</li>;
}

/** Horizontal bars of a few named values (reasons), largest first. */
function ReasonBars({ rows }: { rows: { label: string; value: string; text: ReactNode }[] }) {
  const max = seriesMax(rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.slice(0, SHOWN).map((row) => {
        const percent =
          compareDecimals(max, "0") > 0 ? Number(divideDecimal(row.value, max, 4)) * 100 : 0;
        return (
          <li key={row.label} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <span className="truncate">{row.label}</span>
              <span className="text-muted-foreground tabular-nums">{row.text}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Widget({ widgetKey, context }: { widgetKey: WidgetKey; context: Context }) {
  switch (widgetKey) {
    case "orders_overview":
      return <OrdersOverview context={context} />;
    case "output_today":
      return <OutputToday context={context} />;
    case "orders_due":
      return <OrdersDue context={context} />;
    case "orders_in_progress":
      return <OrdersInProgress context={context} />;
    case "machines_now":
      return <MachinesNow context={context} />;
    case "output_trend":
      return <OutputTrend context={context} />;
    case "downtime_reasons":
      return <DowntimeReasons context={context} />;
    case "scrap_reasons":
      return <ScrapReasons context={context} />;
    case "close_requests":
      return <CloseRequests context={context} />;
    case "attendance_today":
      return <AttendanceToday context={context} />;
    case "attendance_requests":
      return <AttendanceRequests context={context} />;
    case "stock_below_minimum":
      return <StockBelowMinimum context={context} />;
    case "material_shortages":
      return <MaterialShortages context={context} />;
    case "inventory_approvals":
      return <InventoryApprovals context={context} />;
    case "tools_status":
      return <ToolsStatus context={context} />;
    case "finished_goods":
      return <FinishedGoods context={context} />;
    case "recent_delivery_notes":
      return <RecentDeliveryNotes context={context} />;
  }
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

async function OrdersOverview({ context }: { context: Context }) {
  const [t, tStatus, orders] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("orderStatus"),
    loadOpenOrders(context.organizationId),
  ]);
  const overview = ordersOverview(orders);
  return (
    <Frame widgetKey="orders_overview" href="/orders">
      <dl className="grid grid-cols-3 gap-2">
        <Stat label={t("openOrders")} value={overview.total} />
        <Stat
          label={t("overdue")}
          value={overview.overdue}
          tone={overview.overdue > 0 ? "danger" : undefined}
        />
        <Stat
          label={t("behind")}
          value={overview.behind}
          tone={overview.behind > 0 ? "danger" : undefined}
        />
      </dl>
      <ul className="flex flex-col gap-1">
        {overview.byStatus
          .filter((row) => row.count > 0)
          .map((row) => (
            <li key={row.status} className="flex justify-between gap-2">
              <Link href={`/orders?status=${row.status}`} className="hover:underline">
                {tStatus(row.status)}
              </Link>
              <span className="tabular-nums">{row.count}</span>
            </li>
          ))}
      </ul>
    </Frame>
  );
}

async function OutputToday({ context }: { context: Context }) {
  const [t, day] = await Promise.all([
    getTranslations("dashboard"),
    loadProductionToday(context.organizationId, context.timeZone),
  ]);
  if (!day) return null;
  const summary = daySummary(day);
  return (
    <Frame widgetKey="output_today" href="/production">
      <dl className="grid grid-cols-2 gap-2">
        <Stat label={t("good")} value={formatDecimal(summary.good)} />
        <Stat
          label={t("scrap")}
          value={
            summary.scrapRate === null
              ? formatDecimal(summary.scrap)
              : `${formatDecimal(summary.scrap)} (${formatDecimal(summary.scrapRate)} %)`
          }
          tone={compareDecimals(summary.scrap, "0") > 0 ? "danger" : undefined}
        />
        <Stat label={t("downtime")} value={<Duration seconds={summary.downtimeSeconds} />} />
        <Stat label={t("toolChanges")} value={summary.toolChanges} />
      </dl>
      {summary.openDowntime > 0 ? (
        <p className="text-destructive">{t("openDowntime", { count: summary.openDowntime })}</p>
      ) : null}
    </Frame>
  );
}

async function OrdersDue({ context }: { context: Context }) {
  const [t, format, orders] = await Promise.all([
    getTranslations("dashboard"),
    getOrgFormatter(context.timeZone),
    loadOpenOrders(context.organizationId),
  ]);
  const warned = orders.filter((order) => order.dueWarning !== null);
  return (
    <Frame widgetKey="orders_due" href="/orders?due=warning">
      {warned.length === 0 ? (
        <Muted>{t("noDueWarnings")}</Muted>
      ) : (
        <ul className="flex flex-col divide-y">
          {warned.slice(0, SHOWN).map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
                {order.orderNumber}
              </Link>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {order.customer?.name ?? "—"} · {order.product?.partNumber ?? ""}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {format.dateTime(new Date(`${order.dueDate}T12:00:00Z`), {
                  dateStyle: "medium",
                  timeZone: "UTC",
                })}
              </span>
              {order.dueWarning ? <DueWarningBadge warning={order.dueWarning} /> : null}
            </li>
          ))}
          <More count={warned.length} />
        </ul>
      )}
    </Frame>
  );
}

async function OrdersInProgress({ context }: { context: Context }) {
  const [t, orders] = await Promise.all([
    getTranslations("dashboard"),
    loadOpenOrders(context.organizationId),
  ]);
  const active = orders.filter((order) =>
    ["in_progress", "paused", "quality_check"].includes(order.status),
  );
  return (
    <Frame widgetKey="orders_in_progress" href="/orders?status=in_progress">
      {active.length === 0 ? (
        <Muted>{t("noOrdersInProgress")}</Muted>
      ) : (
        <ul className="flex flex-col divide-y">
          {active.slice(0, SHOWN).map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="flex min-w-40 flex-1 flex-col">
                <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
                  {order.orderNumber}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {order.customer?.name ?? "—"} · {order.product?.partNumber ?? ""}
                </span>
              </div>
              <PriorityBadge priority={order.effectivePriority} />
              <OrderStatusBadge status={order.status} />
              <OrderProgress order={order} />
            </li>
          ))}
          <More count={active.length} />
        </ul>
      )}
    </Frame>
  );
}

async function MachinesNow({ context }: { context: Context }) {
  const [t, machines, day] = await Promise.all([
    getTranslations("dashboard"),
    listFloorMachines(context.organizationId),
    loadProductionToday(context.organizationId, context.timeZone),
  ]);
  if (!day) return null;
  return (
    <Frame widgetKey="machines_now" href="/production">
      {machines.length === 0 ? (
        <Muted>{t("noMachines")}</Muted>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {machines.map((machine) => {
            const working = day.working.filter((row) => row.machineId === machine.id);
            const down = day.downtime.find(
              (row) => row.machineId === machine.id && row.endedAt === null,
            );
            return (
              <li key={machine.id} className="flex flex-col gap-1 rounded-lg border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{machine.code}</span>
                  <MachineStatusBadge status={machine.status} />
                </div>
                {working.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {working
                      .map((row) => `${row.employeeName} · ${row.orderNumber} ${row.operationCode}`)
                      .join(", ")}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("nobodyWorking")}</span>
                )}
                {down ? (
                  <StatusBadge tone="danger">{t("downNow", { reason: down.reason })}</StatusBadge>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Frame>
  );
}

const TREND_DAYS = 14;

async function OutputTrend({ context }: { context: Context }) {
  const [t, format, period] = await Promise.all([
    getTranslations("dashboard"),
    getOrgFormatter(context.timeZone),
    loadProductionPeriod(context.organizationId, context.timeZone),
  ]);
  if (!period) return null;
  const days = dailyOutput(
    period.reports,
    lastDays(today(context.timeZone), TREND_DAYS),
    context.timeZone,
  );
  const max = seriesMax(days.map((day) => day.good));
  const label = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      day: "numeric",
      month: "numeric",
      timeZone: "UTC",
    });
  const total = addDecimals(
    days.map((day) => day.good),
    3,
  );
  return (
    <Frame widgetKey="output_trend" href="/production">
      <p className="text-muted-foreground">
        {t("trendTotal", { days: TREND_DAYS, good: formatDecimal(total) })}
      </p>
      {compareDecimals(max, "0") <= 0 ? (
        <Muted>{t("noReports")}</Muted>
      ) : (
        <div
          className="flex h-40 items-end gap-0.5"
          role="img"
          aria-label={t("trendAria", { days: TREND_DAYS })}
        >
          {days.map((day) => {
            const percent = Number(divideDecimal(day.good, max, 4)) * 100;
            const tip = t("trendTip", {
              date: label(day.date),
              good: formatDecimal(day.good),
              scrap: formatDecimal(day.scrap),
            });
            return (
              <div
                key={day.date}
                className="group flex h-full flex-1 flex-col justify-end"
                title={tip}
              >
                <div
                  className="rounded-t-sm bg-primary/80 group-hover:bg-primary"
                  style={{
                    height: `${Math.max(percent, compareDecimals(day.good, "0") > 0 ? 2 : 0)}%`,
                  }}
                />
                <span className="mt-1 text-center text-[10px] text-muted-foreground tabular-nums">
                  {label(day.date)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <table className="sr-only">
        <caption>{t("widgets.output_trend.title")}</caption>
        <thead>
          <tr>
            <th>{t("date")}</th>
            <th>{t("good")}</th>
            <th>{t("scrap")}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{label(day.date)}</td>
              <td>{formatDecimal(day.good)}</td>
              <td>{formatDecimal(day.scrap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

const DOWNTIME_DAYS = 7;

async function DowntimeReasons({ context }: { context: Context }) {
  const [t, period] = await Promise.all([
    getTranslations("dashboard"),
    loadProductionPeriod(context.organizationId, context.timeZone),
  ]);
  if (!period) return null;
  const first = lastDays(today(context.timeZone), DOWNTIME_DAYS)[0] ?? today(context.timeZone);
  const from = Date.parse(dayRange(first, context.timeZone).from);
  // Downtime that ended within the last days (open downtime counts as now).
  const events = period.downtime.filter(
    (row) => Date.parse(row.endedAt ?? new Date().toISOString()) >= from,
  );
  const reasons = downtimeByReason(events);
  return (
    <Frame widgetKey="downtime_reasons" href="/production">
      <Muted>{t("lastDays", { days: DOWNTIME_DAYS })}</Muted>
      {reasons.length === 0 ? (
        <Muted>{t("noDowntime")}</Muted>
      ) : (
        <ReasonBars
          rows={reasons.map((row) => ({
            label: row.reason,
            value: row.seconds,
            text: <Duration seconds={row.seconds} />,
          }))}
        />
      )}
    </Frame>
  );
}

async function ScrapReasons({ context }: { context: Context }) {
  const [t, period] = await Promise.all([
    getTranslations("dashboard"),
    loadProductionPeriod(context.organizationId, context.timeZone),
  ]);
  if (!period) return null;
  const summary = daySummary(period);
  const reasons = scrapByReason(period.reports);
  return (
    <Frame widgetKey="scrap_reasons" href="/production">
      <Muted>
        {t("scrapPeriod", {
          days: 30,
          scrap: formatDecimal(summary.scrap),
          rate: summary.scrapRate === null ? "—" : formatDecimal(summary.scrapRate),
        })}
      </Muted>
      {reasons.length === 0 ? (
        <Muted>{t("noScrap")}</Muted>
      ) : (
        <ReasonBars
          rows={reasons.map((row) => ({
            label: row.reason ?? t("noReason"),
            value: row.scrap,
            text: t("pieces", { count: formatDecimal(row.scrap) }),
          }))}
        />
      )}
    </Frame>
  );
}

async function CloseRequests({ context }: { context: Context }) {
  const [t, tUnits, requests] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("productUnits"),
    listPendingCloseRequests(context.organizationId),
  ]);
  return (
    <Frame widgetKey="close_requests">
      {requests.length === 0 ? (
        <Muted>{t("noCloseRequests")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {requests.slice(0, SHOWN).map((request) => (
            <li key={request.requestId}>
              <Link
                href={`/orders/${request.orderId}?tab=production`}
                className="font-medium hover:underline"
              >
                {request.orderNumber}
              </Link>
              <span className="ml-2 text-muted-foreground">
                {t("closeRow", {
                  good: formatDecimal(request.good),
                  quantity: formatDecimal(request.quantity),
                  unit: tUnits(request.unit),
                })}
              </span>
            </li>
          ))}
          <More count={requests.length} />
        </ul>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

async function AttendanceToday({ context }: { context: Context }) {
  const [t, tStatus, board] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("attendanceBoard.status"),
    loadAttendanceToday(context.organizationId, context.timeZone),
  ]);
  if (!board) return null;
  const rows = boardRows(board.employees, board.rules, new Date());
  const counts = boardCounts(rows);
  const missing = rows.filter((row) => row.status === "absent" || row.status === "late");
  return (
    <Frame widgetKey="attendance_today" href="/attendance">
      <dl className="grid grid-cols-3 gap-2">
        <Stat label={tStatus("present")} value={counts.present} />
        <Stat
          label={tStatus("late")}
          value={counts.late}
          tone={counts.late > 0 ? "danger" : undefined}
        />
        <Stat
          label={tStatus("absent")}
          value={counts.absent}
          tone={counts.absent > 0 ? "danger" : undefined}
        />
      </dl>
      <p className="text-muted-foreground">
        {t("attendanceRest", {
          expected: counts.expected,
          left: counts.left,
          onLeave: counts.on_leave,
        })}
      </p>
      {missing.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {missing.slice(0, SHOWN).map((row) => (
            <li key={row.id} className="flex justify-between gap-2">
              <span>{row.name}</span>
              <StatusBadge tone="danger">{tStatus(row.status)}</StatusBadge>
            </li>
          ))}
          <More count={missing.length} />
        </ul>
      ) : null}
    </Frame>
  );
}

async function AttendanceRequests({ context }: { context: Context }) {
  const [t, tKinds, pending] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("notifications.approvalKinds"),
    loadPendingRequests(context.organizationId),
  ]);
  const items = [
    ...pending.absences.map((item) => ({
      id: item.id,
      name: item.employeeName,
      kind: tKinds(item.kind),
    })),
    ...pending.interruptions.map((item) => ({
      id: item.id,
      name: item.employeeName,
      kind: tKinds("interruption"),
    })),
    ...pending.corrections.map((item) => ({
      id: item.id,
      name: item.employeeName,
      kind: tKinds("correction"),
    })),
  ];
  return (
    <Frame widgetKey="attendance_requests" href="/attendance/requests">
      {items.length === 0 ? (
        <Muted>{t("noRequests")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.slice(0, SHOWN).map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span>{item.name}</span>
              <span className="text-muted-foreground">{item.kind}</span>
            </li>
          ))}
          <More count={items.length} />
        </ul>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

async function quantityFormatter() {
  const tStock = await getTranslations("inventory");
  return (unit: BaseUnit, value: string) =>
    tStock("quantity", {
      value: formatDecimal(toDisplayQuantity(unit, value)),
      unit: tStock(`displayUnits.${displayUnit(unit)}`),
    });
}

async function StockBelowMinimum({ context }: { context: Context }) {
  const [t, quantity, items] = await Promise.all([
    getTranslations("inventory.warnings"),
    quantityFormatter(),
    loadStockItems(context.organizationId),
  ]);
  const below = items.filter((item) => item.belowMinimum);
  return (
    <Frame widgetKey="stock_below_minimum" href="/inventory">
      {below.length === 0 ? (
        <Muted>{t("belowMinimumNone")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {below.slice(0, SHOWN).map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <Link href={`/inventory/${item.id}`} className="hover:underline">
                {item.code} · {item.name}
              </Link>
              <span className="text-destructive tabular-nums">
                {quantity(item.baseUnit, item.ownQuantity)}
              </span>
            </li>
          ))}
          <More count={below.length} />
        </ul>
      )}
    </Frame>
  );
}

async function MaterialShortages({ context }: { context: Context }) {
  const [t, format, quantity, shortages] = await Promise.all([
    getTranslations("inventory.warnings"),
    getOrgFormatter(context.timeZone),
    quantityFormatter(),
    listOrderShortages(context.organizationId),
  ]);
  return (
    <Frame widgetKey="material_shortages">
      {shortages.length === 0 ? (
        <Muted>{t("shortagesNone")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {shortages.slice(0, SHOWN).map((row) => (
            <li key={row.orderId}>
              <Link href={`/orders/${row.orderId}?tab=material`} className="hover:underline">
                {t("shortageRow", {
                  order: row.orderNumber,
                  item: row.itemCode,
                  quantity: quantity(row.baseUnit, row.shortage),
                })}
              </Link>
              <span className="ml-2 text-muted-foreground">
                {format.dateTime(new Date(`${row.dueDate}T12:00:00Z`), {
                  dateStyle: "medium",
                  timeZone: "UTC",
                })}
              </span>
            </li>
          ))}
          <More count={shortages.length} />
        </ul>
      )}
    </Frame>
  );
}

async function InventoryApprovals({ context }: { context: Context }) {
  const [t, adjustments, counts] = await Promise.all([
    getTranslations("inventory.warnings"),
    countPendingAdjustments(context.organizationId),
    countSubmittedStockCounts(context.organizationId),
  ]);
  return (
    <Frame widgetKey="inventory_approvals">
      {adjustments === 0 && counts === 0 ? (
        <Muted>{t("nothingToApprove")}</Muted>
      ) : (
        <>
          {adjustments > 0 ? (
            <Link href="/inventory/adjustments" className="hover:underline">
              {t("pendingAdjustments", { count: adjustments })}
            </Link>
          ) : null}
          {counts > 0 ? (
            <Link href="/inventory/counts" className="hover:underline">
              {t("submittedCounts", { count: counts })}
            </Link>
          ) : null}
        </>
      )}
    </Frame>
  );
}

async function ToolsStatus({ context }: { context: Context }) {
  const [t, tools] = await Promise.all([
    getTranslations("dashboard"),
    listTools(context.organizationId),
  ]);
  const active = tools.filter((tool) => !tool.archived);
  const below = active.filter((tool) => tool.belowMinimum);
  const inUse = active.flatMap((tool) =>
    tool.inUse.map((use) => ({ ...use, tool, key: `${tool.id}-${use.machine}` })),
  );
  return (
    <Frame widgetKey="tools_status" href="/inventory/tools">
      {below.length === 0 ? (
        <Muted>{t("toolsAboveMinimum")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {below.slice(0, SHOWN).map((tool) => (
            <li key={tool.id} className="flex justify-between gap-2">
              <span>
                {tool.code} · {tool.name}
              </span>
              <span className="text-destructive tabular-nums">
                {t("pieces", { count: String(tool.total) })}
              </span>
            </li>
          ))}
          <More count={below.length} />
        </ul>
      )}
      {inUse.length > 0 ? (
        <>
          <p className="mt-1 font-medium">{t("insertsInUse")}</p>
          <ul className="flex flex-col gap-1">
            {inUse.slice(0, SHOWN).map((use) => (
              <li key={use.key} className="flex justify-between gap-2">
                <span className="truncate">
                  {use.machine} · {use.tool.code}
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    use.edgesUsed >= (use.tool.cuttingEdges ?? 0)
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {t("edge", { used: use.edgesUsed, edges: use.tool.cuttingEdges ?? 0 })}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Frame>
  );
}

async function FinishedGoods({ context }: { context: Context }) {
  const [t, stock] = await Promise.all([
    getTranslations("dashboard"),
    listFinishedStock(context.organizationId),
  ]);
  const onHand = stock.filter((row) => compareDecimals(row.onHand, "0") > 0);
  const byCustomer = new Map<string, { customer: string; pieces: string; orders: number }>();
  for (const row of onHand) {
    const current = byCustomer.get(row.customerId) ?? {
      customer: row.customer,
      pieces: "0",
      orders: 0,
    };
    byCustomer.set(row.customerId, {
      customer: row.customer,
      pieces: addDecimals([current.pieces, row.onHand], 3),
      orders: current.orders + 1,
    });
  }
  const customers = [...byCustomer.values()].sort((a, b) => compareDecimals(b.pieces, a.pieces));
  return (
    <Frame widgetKey="finished_goods" href="/inventory/finished">
      {customers.length === 0 ? (
        <Muted>{t("noFinishedGoods")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {customers.slice(0, SHOWN).map((row) => (
            <li key={row.customer} className="flex justify-between gap-2">
              <span className="truncate">{row.customer}</span>
              <span className="text-muted-foreground tabular-nums">
                {t("finishedRow", { pieces: formatDecimal(row.pieces), orders: row.orders })}
              </span>
            </li>
          ))}
          <More count={customers.length} />
        </ul>
      )}
    </Frame>
  );
}

async function RecentDeliveryNotes({ context }: { context: Context }) {
  const [t, format, notes] = await Promise.all([
    getTranslations("dashboard"),
    getOrgFormatter(context.timeZone),
    listDeliveryNotes(context.organizationId, SHOWN),
  ]);
  return (
    <Frame widgetKey="recent_delivery_notes" href="/inventory/delivery-notes">
      {notes.length === 0 ? (
        <Muted>{t("noDeliveryNotes")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1">
          {notes.slice(0, SHOWN).map((note) => (
            <li key={note.id} className="flex flex-wrap justify-between gap-x-2">
              <Link
                href={`/inventory/delivery-notes/${note.id}`}
                className={cn(
                  "font-medium hover:underline",
                  note.status === "cancelled" && "line-through",
                )}
              >
                {note.number}
              </Link>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{note.customer}</span>
              <span className="text-muted-foreground tabular-nums">
                {format.dateTime(new Date(`${note.issuedOn}T12:00:00Z`), {
                  dateStyle: "medium",
                  timeZone: "UTC",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
