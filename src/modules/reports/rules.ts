// Report figures from the facts of report_production / report_orders /
// report_inventory (D-043), pure and unit-tested. Times are seconds
// (numbers); quantities and money are exact decimal strings.

import { addDecimals, compareDecimals, divideDecimal } from "@/lib/decimal";
import { daysBetween } from "@/modules/attendance/schedule-rules";
import { capacitySeconds, isWorkingDay } from "@/modules/planning/rules";
import type { InventoryFacts, OrderFact, ProductionFacts } from "./queries";
import type { ProductionGroup, ReportFilters } from "./schemas";

type Filters = Pick<ReportFilters, "machine" | "employee" | "customer" | "order">;

/** Facts limited to a machine, worker, customer and / or order. */
export function filterProduction(facts: ProductionFacts, filters: Filters): ProductionFacts {
  const customerOf = new Map(facts.orders.map((o) => [o.id, o.customer_id]));
  const keep = (row: {
    machine_id?: string | null;
    employee_id?: string | null;
    order_id?: string;
  }) =>
    (!filters.machine || row.machine_id === filters.machine) &&
    (!filters.employee || !("employee_id" in row) || row.employee_id === filters.employee) &&
    (!filters.order || row.order_id === filters.order) &&
    (!filters.customer ||
      (row.order_id !== undefined && customerOf.get(row.order_id) === filters.customer));
  // Machine running time has no worker: with a worker filter it is left out.
  const machineTime = filters.employee ? [] : facts.machine_time.filter(keep);
  return {
    ...facts,
    output: facts.output.filter(keep),
    scrap: facts.scrap.filter(keep),
    machine_time: machineTime,
    worker_time: facts.worker_time.filter(keep),
    downtime: facts.downtime.filter(keep),
    tool_changes: facts.tool_changes.filter(
      (row) =>
        (!filters.machine || row.machine_id === filters.machine) &&
        !filters.employee &&
        !filters.order &&
        !filters.customer,
    ),
  };
}

/** part / whole in percent, one decimal; null when whole is 0. */
export function percentOf(part: string, whole: string): string | null {
  if (compareDecimals(whole, "0") <= 0) return null;
  return divideDecimal(part, divideDecimal(whole, "100", 6), 1);
}

export type ProductionRow = {
  key: string;
  label: string;
  good: string;
  scrap: string;
  scrapRate: string | null;
  /** Machine running time (by worker: the worker's own time). */
  seconds: number;
  /** Routing time of the reported pieces (cycle × pieces, without setup). */
  plannedSeconds: number;
  /** Routing time ÷ actual time in percent (100 = as planned, lower = slower). */
  efficiency: number | null;
  goodPerHour: number | null;
};

function labelFor(facts: ProductionFacts, group: ProductionGroup) {
  const machines = new Map(facts.machines.map((m) => [m.id, `${m.code} · ${m.name}`]));
  const employees = new Map(facts.employees.map((e) => [e.id, e.name]));
  const shifts = new Map(facts.shifts.map((s) => [s.id, `${s.code} · ${s.name}`]));
  const orders = new Map(facts.orders.map((o) => [o.id, o]));
  return (row: {
    day: string;
    machine_id?: string | null;
    employee_id?: string | null;
    shift_id?: string | null;
    order_id: string;
  }) => {
    switch (group) {
      case "day":
        return { key: row.day, label: row.day };
      case "machine":
        return row.machine_id
          ? { key: row.machine_id, label: machines.get(row.machine_id) ?? row.machine_id }
          : { key: "-", label: "" };
      case "shift":
        return row.shift_id
          ? { key: row.shift_id, label: shifts.get(row.shift_id) ?? row.shift_id }
          : { key: "-", label: "" };
      case "employee":
        return row.employee_id
          ? { key: row.employee_id, label: employees.get(row.employee_id) ?? row.employee_id }
          : { key: "-", label: "" };
      case "order": {
        const order = orders.get(row.order_id);
        return {
          key: row.order_id,
          label: order
            ? `${order.number} · ${order.part_number ?? ""} ${order.product ?? ""}`.trim()
            : row.order_id,
        };
      }
      case "customer": {
        const order = orders.get(row.order_id);
        return { key: order?.customer_id ?? "-", label: order?.customer ?? "" };
      }
    }
  };
}

/**
 * Output grouped by day, machine, worker, order or customer: good and
 * scrap, time, routing time of those pieces, efficiency and good per hour.
 * By worker the time is the worker's sessions, otherwise machine running time.
 */
export function productionRows(facts: ProductionFacts, group: ProductionGroup): ProductionRow[] {
  const label = labelFor(facts, group);
  const rows = new Map<
    string,
    { label: string; good: string[]; scrap: string[]; seconds: number; planned: number }
  >();
  const row = (key: string, text: string) => {
    let current = rows.get(key);
    if (!current) {
      current = { label: text, good: [], scrap: [], seconds: 0, planned: 0 };
      rows.set(key, current);
    }
    return current;
  };
  for (const fact of facts.output) {
    const { key, label: text } = label(fact);
    const current = row(key, text);
    current.good.push(fact.good);
    current.scrap.push(fact.scrap);
    current.planned += fact.planned_seconds;
  }
  // Workers and shifts: the workers' time (machine time has neither).
  const times = group === "employee" || group === "shift" ? facts.worker_time : facts.machine_time;
  for (const fact of times) {
    const { key, label: text } = label(fact);
    row(key, text).seconds += fact.seconds;
  }
  return [...rows.entries()]
    .map(([key, value]): ProductionRow => {
      const good = addDecimals(value.good, 3);
      const scrap = addDecimals(value.scrap, 3);
      return {
        key,
        label: value.label,
        good,
        scrap,
        scrapRate: percentOf(scrap, addDecimals([good, scrap], 3)),
        seconds: value.seconds,
        plannedSeconds: value.planned,
        efficiency:
          value.seconds > 0 && value.planned > 0
            ? Math.round((value.planned / value.seconds) * 1000) / 10
            : null,
        goodPerHour:
          value.seconds > 0 ? Math.round((Number(good) / (value.seconds / 3600)) * 10) / 10 : null,
      };
    })
    .sort((a, b) =>
      group === "day"
        ? a.key.localeCompare(b.key)
        : b.seconds - a.seconds || a.label.localeCompare(b.label),
    );
}

/** The whole period as one row (machine running time). */
export function productionTotal(facts: ProductionFacts): ProductionRow | null {
  const all = {
    ...facts,
    output: facts.output.map((row) => ({ ...row, day: "" })),
    machine_time: facts.machine_time.map((row) => ({ ...row, day: "" })),
  };
  return productionRows(all, "day")[0] ?? null;
}

/** Good pieces per day, every day of the period (0 when nothing was reported). */
export function dailyGood(
  facts: ProductionFacts,
  days: readonly string[],
): { day: string; good: string }[] {
  const byDay = new Map<string, string[]>();
  for (const fact of facts.output) byDay.set(fact.day, [...(byDay.get(fact.day) ?? []), fact.good]);
  return days.map((day) => ({ day, good: addDecimals(byDay.get(day) ?? [], 3) }));
}

/** Sums by a text key, largest first. */
function sumBy<T>(rows: readonly T[], key: (row: T) => string, value: (row: T) => number) {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(key(row), (sums.get(key(row)) ?? 0) + value(row));
  return [...sums.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

export function scrapByReason(facts: ProductionFacts, otherLabel: string) {
  const sums = new Map<string, string[]>();
  for (const row of facts.scrap) {
    const reason = row.reason ?? otherLabel;
    sums.set(reason, [...(sums.get(reason) ?? []), row.scrap]);
  }
  return [...sums.entries()]
    .map(([reason, values]) => ({ reason, scrap: addDecimals(values, 3) }))
    .sort((a, b) => compareDecimals(b.scrap, a.scrap));
}

export function downtimeByReason(facts: ProductionFacts) {
  return sumBy(
    facts.downtime,
    (row) => row.reason,
    (row) => row.seconds,
  ).map((row) => ({
    reason: row.name,
    seconds: row.total,
  }));
}

export type MachineRow = {
  id: string;
  label: string;
  /** Hours the machine could work in the period (capacity × days it can run). */
  capacitySeconds: number;
  runSeconds: number;
  downtimeSeconds: number;
  idleSeconds: number;
  /** Running time in percent of the capacity, one decimal. */
  utilization: number | null;
  toolChanges: number;
  toolChangeMinutes: number;
};

/**
 * Machine use in the period: capacity (working days, plus every day for a
 * machine that runs unattended), running time, downtime, the rest idle.
 */
export function machineRows(
  facts: ProductionFacts,
  options: {
    days: readonly string[];
    holidays: ReadonlySet<string>;
    workHoursPerDay: number;
    machine?: string;
  },
): MachineRow[] {
  return facts.machines
    .filter((m) => (options.machine ? m.id === options.machine : true))
    .map((machine): MachineRow => {
      const perDay = capacitySeconds(
        {
          id: machine.id,
          runsUnattended: machine.runs_unattended,
          capacityHours: machine.capacity_hours === null ? null : Number(machine.capacity_hours),
        },
        options.workHoursPerDay,
      );
      const days = options.days.filter(
        (day) => machine.runs_unattended || isWorkingDay(day, { holidays: options.holidays }),
      ).length;
      const capacity = perDay * days;
      const run = facts.machine_time
        .filter((r) => r.machine_id === machine.id)
        .reduce((s, r) => s + r.seconds, 0);
      const down = facts.downtime
        .filter((r) => r.machine_id === machine.id)
        .reduce((s, r) => s + r.seconds, 0);
      const tools = facts.tool_changes.filter((r) => r.machine_id === machine.id);
      return {
        id: machine.id,
        label: `${machine.code} · ${machine.name}`,
        capacitySeconds: capacity,
        runSeconds: run,
        downtimeSeconds: down,
        idleSeconds: Math.max(capacity - run - down, 0),
        utilization: capacity > 0 ? Math.round((run / capacity) * 1000) / 10 : null,
        toolChanges: tools.reduce((s, r) => s + r.changes, 0),
        toolChangeMinutes: tools.reduce((s, r) => s + r.minutes, 0),
      };
    })
    .filter((row) => row.capacitySeconds > 0 || row.runSeconds > 0 || row.downtimeSeconds > 0);
}

export type OrderRow = OrderFact & {
  /** Days after the due date (completion day, or today while open); 0 on time. */
  lateDays: number;
  open: boolean;
  totalCost: string;
  costPerPiece: string | null;
};

export function orderRows(
  orders: readonly OrderFact[],
  today: string,
  filters: Filters,
): OrderRow[] {
  return orders
    .filter(
      (o) =>
        (!filters.customer || o.customer_id === filters.customer) &&
        (!filters.order || o.id === filters.order),
    )
    .map((order): OrderRow => {
      const open = order.completed_on === null;
      const end = order.completed_on ?? today;
      const totalCost = addDecimals(
        [order.material_cost, order.machine_cost, order.external_cost],
        4,
      );
      return {
        ...order,
        open,
        lateDays: Math.max(daysBetween(order.due_date, end), 0),
        totalCost,
        costPerPiece:
          compareDecimals(order.good, "0") > 0 ? divideDecimal(totalCost, order.good, 2) : null,
      };
    });
}

export type OrderSummary = {
  completed: number;
  onTime: number;
  /** On time in percent of completed, one decimal. */
  onTimePercent: number | null;
  /** Average days late of the late completed orders. */
  averageLateDays: number | null;
  openLate: number;
  totalCost: string;
};

export function orderSummary(rows: readonly OrderRow[]): OrderSummary {
  const completed = rows.filter((r) => !r.open);
  const late = completed.filter((r) => r.lateDays > 0);
  return {
    completed: completed.length,
    onTime: completed.length - late.length,
    onTimePercent:
      completed.length > 0
        ? Math.round(((completed.length - late.length) / completed.length) * 1000) / 10
        : null,
    averageLateDays:
      late.length > 0
        ? Math.round((late.reduce((s, r) => s + r.lateDays, 0) / late.length) * 10) / 10
        : null,
    openLate: rows.filter((r) => r.open && r.lateDays > 0).length,
    totalCost: addDecimals(
      rows.map((r) => r.totalCost),
      4,
    ),
  };
}

/** Completed orders, on time and late, per customer. */
export function onTimeByCustomer(rows: readonly OrderRow[], noCustomer: string) {
  const byCustomer = new Map<
    string,
    { name: string; completed: number; late: number; lateDays: number }
  >();
  for (const row of rows) {
    if (row.open) continue;
    const key = row.customer_id ?? "-";
    const current = byCustomer.get(key) ?? {
      name: row.customer ?? noCustomer,
      completed: 0,
      late: 0,
      lateDays: 0,
    };
    current.completed += 1;
    if (row.lateDays > 0) {
      current.late += 1;
      current.lateDays += row.lateDays;
    }
    byCustomer.set(key, current);
  }
  return [...byCustomer.values()].sort(
    (a, b) => b.completed - a.completed || a.name.localeCompare(b.name),
  );
}

export type MaterialRow = {
  itemId: string;
  label: string;
  unit: string;
  quantity: string;
  massKg: string;
  value: string;
};

/** Net material issued to orders (issues − returns) per item, by value. */
export function materialConsumption(facts: InventoryFacts, filters: Filters): MaterialRow[] {
  const items = new Map(facts.items.map((i) => [i.id, i]));
  const rows = new Map<string, { quantity: string[]; mass: string[]; value: string[] }>();
  for (const row of facts.consumption) {
    if (filters.order && row.order_id !== filters.order) continue;
    const current = rows.get(row.item_id) ?? { quantity: [], mass: [], value: [] };
    current.quantity.push(row.quantity);
    current.mass.push(row.mass_kg);
    current.value.push(row.value);
    rows.set(row.item_id, current);
  }
  return [...rows.entries()]
    .map(([itemId, value]) => {
      const item = items.get(itemId);
      return {
        itemId,
        label: item ? `${item.code} · ${item.name}` : itemId,
        unit: item?.unit ?? "",
        quantity: addDecimals(value.quantity, 6),
        massKg: addDecimals(value.mass, 4),
        value: addDecimals(value.value, 4),
      };
    })
    .sort((a, b) => compareDecimals(b.value, a.value));
}

/** Own stock today per item and its total value. */
export function stockValuation(facts: InventoryFacts): { rows: MaterialRow[]; total: string } {
  const items = new Map(facts.items.map((i) => [i.id, i]));
  const rows = facts.stock
    .map((row) => {
      const item = items.get(row.item_id);
      return {
        itemId: row.item_id,
        label: item ? `${item.code} · ${item.name}` : row.item_id,
        unit: item?.unit ?? "",
        quantity: row.quantity,
        massKg: row.mass_kg,
        value: row.value,
      };
    })
    .sort((a, b) => compareDecimals(b.value, a.value));
  return {
    rows,
    total: addDecimals(
      rows.map((r) => r.value),
      4,
    ),
  };
}

/** Tools used up and scrapped per tool (pieces), optionally on one machine. */
export function toolConsumption(facts: InventoryFacts, machine?: string) {
  const rows = new Map<
    string,
    { code: string; name: string; kind: string; consumed: number; scrapped: number }
  >();
  for (const row of facts.tools) {
    if (machine && row.machine_id !== machine) continue;
    const current = rows.get(row.tool_id) ?? {
      code: row.code,
      name: row.name,
      kind: row.kind,
      consumed: 0,
      scrapped: 0,
    };
    current.consumed += row.consumed ?? 0;
    current.scrapped += row.scrapped ?? 0;
    rows.set(row.tool_id, current);
  }
  return [...rows.values()].sort((a, b) => b.consumed + b.scrapped - (a.consumed + a.scrapped));
}
