import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dateRange } from "@/modules/attendance/schedule-rules";
import { getOrderSettings } from "@/modules/production-orders/queries";
import { getInventoryFacts, getOrderFacts, getProductionFacts } from "./queries";
import {
  dailyGood,
  downtimeByReason,
  filterProduction,
  machineRows,
  materialConsumption,
  orderRows,
  orderSummary,
  onTimeByCustomer,
  productionRows,
  productionTotal,
  scrapByReason,
  stockValuation,
  toolConsumption,
} from "./rules";
import type { ReportFilters } from "./schemas";

// One report tab with its figures, shared by /reports and the Excel export.

export type FilterOptions = {
  machines: { id: string; label: string }[];
  employees: { id: string; label: string }[];
  customers: { id: string; label: string }[];
  orders: { id: string; label: string }[];
};

async function holidaysBetween(organizationId: string, from: string, to: string) {
  const supabase = await createClient();
  const [holidays, rules] = await Promise.all([
    supabase
      .from("org_holidays")
      .select("key, date")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .gte("date", from)
      .lte("date", to),
    supabase.from("org_holiday_rules").select("key, scope").eq("organization_id", organizationId),
  ]);
  const everybody = new Set((rules.data ?? []).filter((r) => r.scope === "all").map((r) => r.key));
  return new Set((holidays.data ?? []).filter((h) => everybody.has(h.key)).map((h) => h.date));
}

export async function loadReport(organizationId: string, filters: ReportFilters, today: string) {
  const days = dateRange(filters.from, filters.to);
  if (filters.tab === "production" || filters.tab === "machines") {
    const all = await getProductionFacts(organizationId, filters.from, filters.to);
    const facts = filterProduction(all, filters);
    const options: FilterOptions = {
      machines: all.machines
        .filter((m) => !m.archived || all.machine_time.some((r) => r.machine_id === m.id))
        .map((m) => ({ id: m.id, label: `${m.code} · ${m.name}` })),
      employees: all.employees
        .filter(
          (e) =>
            all.worker_time.some((r) => r.employee_id === e.id) ||
            all.output.some((r) => r.employee_id === e.id),
        )
        .map((e) => ({ id: e.id, label: e.name })),
      customers: [
        ...new Map(
          all.orders.flatMap((o) =>
            o.customer_id && o.customer ? [[o.customer_id, o.customer] as const] : [],
          ),
        ),
      ]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      orders: all.orders
        .map((o) => ({ id: o.id, label: o.number }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
    if (filters.tab === "production") {
      return {
        tab: "production" as const,
        group: filters.group,
        options,
        rows: productionRows(facts, filters.group),
        daily: dailyGood(facts, days),
        scrap: scrapByReason(facts, ""),
        downtime: downtimeByReason(facts),
        total: productionTotal(facts),
      };
    }
    const [settings, holidays] = await Promise.all([
      getOrderSettings(organizationId),
      holidaysBetween(organizationId, filters.from, filters.to),
    ]);
    return {
      tab: "machines" as const,
      options,
      machines: machineRows(facts, {
        days,
        holidays,
        workHoursPerDay: settings.workHoursPerDay,
        machine: filters.machine,
      }),
      downtime: downtimeByReason(facts),
      toolChanges: facts.tool_changes,
    };
  }

  const orders = await getOrderFacts(organizationId, filters.from, filters.to);
  const options: FilterOptions = {
    machines: [],
    employees: [],
    customers: [
      ...new Map(
        orders.flatMap((o) =>
          o.customer_id && o.customer ? [[o.customer_id, o.customer] as const] : [],
        ),
      ),
    ]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    orders: orders
      .map((o) => ({ id: o.id, label: o.number }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
  const rows = orderRows(orders, today, filters);
  if (filters.tab === "orders") {
    return {
      tab: "orders" as const,
      options,
      rows,
      summary: orderSummary(rows),
      customers: onTimeByCustomer(rows, ""),
    };
  }
  const inventory = await getInventoryFacts(organizationId, filters.from, filters.to);
  return {
    tab: "costs" as const,
    options,
    rows: rows.filter((r) => !r.open),
    summary: orderSummary(rows.filter((r) => !r.open)),
    material: materialConsumption(inventory, filters),
    stock: stockValuation(inventory),
    tools: toolConsumption(inventory, filters.machine),
  };
}

export type ReportData = Awaited<ReturnType<typeof loadReport>>;
