import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getOrderSettings,
  listAssignmentOptions,
  listOpenOrders,
  type OrderRow,
} from "@/modules/production-orders/queries";
import { isOperationStatus, type OperationStatus } from "@/modules/production-orders/status-rules";
import { historicCycleSeconds } from "./rules";

// Data of the planning board (D-041), read through RLS.

export type PlanningMachine = {
  id: string;
  code: string;
  name: string;
  typeName: string | null;
  status: string;
  runsUnattended: boolean;
  capacityHours: number | null;
};

export type PlanningOperation = {
  id: string;
  orderId: string;
  sequence: number;
  sourceOperationId: string | null;
  code: string;
  name: string;
  isExternal: boolean;
  isInspection: boolean;
  externalCompany: string | null;
  machineId: string | null;
  status: OperationStatus;
  planDay: string | null;
  position: number | null;
  addedAt: string | null;
  setupMin: number;
  /** Routing cycle per piece. */
  cycleSeconds: number | null;
  goodQuantity: number;
  scrapQuantity: number;
  runSeconds: number;
  workers: { id: string; name: string }[];
};

export type PlanningDowntime = {
  id: string;
  machineId: string;
  startsOn: string;
  endsOn: string | null;
  reasonId: string | null;
  reasonName: string | null;
  note: string | null;
};

export type PlanningData = {
  machines: PlanningMachine[];
  orders: Map<string, OrderRow>;
  operations: PlanningOperation[];
  /** Actual cycle per piece of earlier runs by routing step (source operation). */
  historicCycles: Map<string, number>;
  downtimes: PlanningDowntime[];
  holidays: { date: string; name: string }[];
  /** Approved absences; endDate null = open sick leave. */
  absences: { employeeId: string; startDate: string; endDate: string | null }[];
  employees: Awaited<ReturnType<typeof listAssignmentOptions>>["employees"];
  reasons: { id: string; name: string }[];
  workHoursPerDay: number;
};

const workersSchema = z.array(z.object({ employee_id: z.uuid(), name: z.string() }));
const num = (value: number | string | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value);

const OPERATION_COLUMNS =
  "id, order_id, sequence, source_operation_id, operation_code, operation_name, is_external, is_inspection, external_company, machine_id, status, plan_day, plan_position, plan_added_at, setup_time_min, cycle_time_s, good_quantity, scrap_quantity, run_seconds, workers";

export async function getPlanningData(
  organizationId: string,
  from: string,
  to: string,
): Promise<PlanningData> {
  const supabase = await createClient();
  const [
    orders,
    settings,
    options,
    machines,
    operations,
    downtimes,
    holidays,
    rules,
    absences,
    reasons,
  ] = await Promise.all([
    listOpenOrders(organizationId),
    getOrderSettings(organizationId),
    listAssignmentOptions(organizationId),
    supabase
      .from("machine_directory")
      .select("id, code, name, type_name, status, runs_unattended, capacity_hours")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .neq("status", "inactive")
      .order("code"),
    supabase
      .from("production_order_operation_directory")
      .select(OPERATION_COLUMNS)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .neq("status", "done")
      .order("sequence"),
    supabase
      .from("machine_downtimes")
      .select("id, machine_id, starts_on, ends_on, reason_id, note, reason:catalog_items(name)")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .or(`ends_on.is.null,ends_on.gte.${from}`)
      .order("starts_on"),
    supabase
      .from("org_holidays")
      .select("key, date, name")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .gte("date", from)
      .lte("date", to),
    supabase.from("org_holiday_rules").select("key, scope").eq("organization_id", organizationId),
    supabase
      .from("absences")
      .select("employee_id, start_date, end_date")
      .eq("organization_id", organizationId)
      .eq("status", "approved")
      .lte("start_date", to)
      .or(`end_date.is.null,end_date.gte.${from}`),
    supabase
      .from("catalog_items")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("kind", "downtime_reason")
      .is("archived_at", null)
      .order("name"),
  ]);
  if (machines.error) throw machines.error;
  if (operations.error) throw operations.error;
  if (downtimes.error) throw downtimes.error;
  if (reasons.error) throw reasons.error;

  const openOrders = new Map(orders.map((order) => [order.id, order]));
  const rows = operations.data.flatMap((row): PlanningOperation[] => {
    if (!row.id || !row.order_id || row.sequence === null || !openOrders.has(row.order_id))
      return [];
    if (!isOperationStatus(row.status) || row.status === "done") return [];
    const workers = workersSchema.safeParse(row.workers);
    return [
      {
        id: row.id,
        orderId: row.order_id,
        sequence: row.sequence,
        sourceOperationId: row.source_operation_id,
        code: row.operation_code ?? "",
        name: row.operation_name ?? "",
        isExternal: row.is_external ?? false,
        isInspection: row.is_inspection ?? false,
        externalCompany: row.external_company,
        machineId: row.machine_id,
        status: row.status,
        planDay: row.plan_day,
        position: row.plan_position,
        addedAt: row.plan_added_at,
        setupMin: num(row.setup_time_min),
        cycleSeconds: row.cycle_time_s === null ? null : Number(row.cycle_time_s),
        goodQuantity: num(row.good_quantity),
        scrapQuantity: num(row.scrap_quantity),
        runSeconds: num(row.run_seconds),
        workers: workers.success
          ? workers.data.map((w) => ({ id: w.employee_id, name: w.name }))
          : [],
      },
    ];
  });

  // Earlier runs of the same routing steps, newest first, for the actual cycle.
  const sources = [
    ...new Set(rows.filter((op) => !op.isExternal).flatMap((op) => op.sourceOperationId ?? [])),
  ];
  const historicCycles = new Map<string, number>();
  for (let i = 0; i < sources.length; i += 100) {
    const chunk = sources.slice(i, i + 100);
    const done = await supabase
      .from("production_order_operation_directory")
      .select("source_operation_id, setup_time_min, good_quantity, scrap_quantity, run_seconds")
      .eq("organization_id", organizationId)
      .eq("status", "done")
      .in("source_operation_id", chunk)
      .order("status_changed_at", { ascending: false })
      .limit(500);
    if (done.error) throw done.error;
    const runs = new Map<string, { runSeconds: number; setupMin: number; pieces: number }[]>();
    for (const row of done.data) {
      if (!row.source_operation_id) continue;
      const list = runs.get(row.source_operation_id) ?? [];
      if (list.length >= 5) continue;
      list.push({
        runSeconds: num(row.run_seconds),
        setupMin: num(row.setup_time_min),
        pieces: num(row.good_quantity) + num(row.scrap_quantity),
      });
      runs.set(row.source_operation_id, list);
    }
    for (const [source, list] of runs) {
      const cycle = historicCycleSeconds(list);
      if (cycle !== null) historicCycles.set(source, cycle);
    }
  }

  const everybody = new Set(
    (rules.data ?? []).filter((rule) => rule.scope === "all").map((rule) => rule.key),
  );

  return {
    machines: machines.data.flatMap((row): PlanningMachine[] =>
      row.id && row.code && row.name
        ? [
            {
              id: row.id,
              code: row.code,
              name: row.name,
              typeName: row.type_name,
              status: row.status ?? "available",
              runsUnattended: row.runs_unattended ?? false,
              capacityHours: row.capacity_hours === null ? null : Number(row.capacity_hours),
            },
          ]
        : [],
    ),
    orders: openOrders,
    operations: rows,
    historicCycles,
    downtimes: downtimes.data.map((row) => ({
      id: row.id,
      machineId: row.machine_id,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      reasonId: row.reason_id,
      reasonName: row.reason?.name ?? null,
      note: row.note,
    })),
    holidays: (holidays.data ?? [])
      .filter((holiday) => everybody.has(holiday.key))
      .map((holiday) => ({ date: holiday.date, name: holiday.name })),
    absences: (absences.data ?? []).map((row) => ({
      employeeId: row.employee_id,
      startDate: row.start_date,
      endDate: row.end_date,
    })),
    employees: options.employees,
    reasons: reasons.data,
    workHoursPerDay: settings.workHoursPerDay,
  };
}
