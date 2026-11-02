import { addDays, dateRange } from "@/modules/attendance/schedule-rules";
import type { OrderRow } from "@/modules/production-orders/queries";
import type { OperationStatus } from "@/modules/production-orders/status-rules";
import type { PlanningData, PlanningDowntime, PlanningOperation } from "./queries";
import {
  capacitySeconds,
  historicCycleSeconds,
  HOUR,
  isWorkingDay,
  operationWarnings,
  operatorLoad,
  rebalanceMachine,
  remainingSeconds,
  scheduleMachine,
  unplannedOrder,
  type Calendar,
  type DayLoad,
  type OperationForecast,
  type OperationWarning,
  type PlanBasis,
  type PlanOperation,
} from "./rules";

// The planning board as plain data for the client (D-041): machines × days,
// cards with durations, forecasts and warnings, operations not planned yet,
// operator load and the proposed moves for overloaded days.

export type BoardCard = {
  id: string;
  orderId: string;
  orderNumber: string;
  partNumber: string;
  productName: string;
  customerName: string | null;
  code: string;
  name: string;
  sequence: number;
  quantity: string;
  unit: OrderRow["unit"];
  status: OperationStatus;
  priority: number;
  manualPriority: number | null;
  dueDate: string;
  machineId: string | null;
  planDay: string | null;
  position: number | null;
  plannedSeconds: number;
  actualSeconds: number | null;
  actualSource: "own" | "history" | null;
  /** Actual vs routing cycle in percent (+12 = slower); null when unknown. */
  deviationPercent: number | null;
  workers: { id: string; name: string }[];
  forecast: OperationForecast | null;
  warnings: OperationWarning[];
  /** An earlier external operation of the order is not back yet. */
  waitingExternal: {
    code: string;
    name: string;
    company: string | null;
    status: OperationStatus;
  } | null;
};

export type BoardDay = { date: string; working: boolean; holiday: string | null; today: boolean };

export type BoardMachine = {
  id: string;
  code: string;
  name: string;
  typeName: string | null;
  runsUnattended: boolean;
  capacityHours: number;
  days: Record<string, DayLoad & { continuing: { id: string; label: string }[] }>;
  downtimes: PlanningDowntime[];
  proposal: { operationId: string; label: string; from: string | null; to: string }[];
};

export type BoardWorker = {
  id: string;
  name: string;
  machineIds: string[];
  /** Operator seconds per day (window only). */
  load: Record<string, number>;
  absent: string[];
};

export type BoardModel = {
  from: string;
  to: string;
  today: string;
  basis: PlanBasis;
  workHoursPerDay: number;
  days: BoardDay[];
  machines: BoardMachine[];
  cards: BoardCard[];
  unplanned: BoardCard[];
  workers: BoardWorker[];
  reasons: { id: string; name: string }[];
};

/** Remaining machine time of an operation by the routing and by the actual cycle. */
export function operationDurations(
  op: PlanningOperation,
  quantity: number,
  historicCycles: ReadonlyMap<string, number>,
): {
  planned: number;
  actual: number | null;
  actualCycle: number | null;
  actualSource: "own" | "history" | null;
} {
  const started = op.status === "in_progress" || op.status === "paused";
  const base = { started, setupMin: op.setupMin, quantity, goodQuantity: op.goodQuantity };
  const planned = remainingSeconds({ ...base, cycleSeconds: op.cycleSeconds }) ?? 0;
  const pieces = op.goodQuantity + op.scrapQuantity;
  const own =
    pieces > 0
      ? historicCycleSeconds([{ runSeconds: op.runSeconds, setupMin: op.setupMin, pieces }])
      : null;
  const history = op.sourceOperationId ? (historicCycles.get(op.sourceOperationId) ?? null) : null;
  const actualCycle = own ?? history;
  return {
    planned,
    actual: actualCycle === null ? null : remainingSeconds({ ...base, cycleSeconds: actualCycle }),
    actualCycle,
    actualSource: own !== null ? "own" : history !== null ? "history" : null,
  };
}

/** Calendar and plan entries of the machine operations, shared by the board and the actions. */
export function buildBoardInputs(data: PlanningData) {
  const holidays = new Map(data.holidays.map((h) => [h.date, h.name]));
  const calendar: Calendar = {
    holidays: new Set(holidays.keys()),
    downtimes: data.downtimes,
  };

  const machineOps = data.operations.filter((op) => !op.isExternal && !op.isInspection);
  const plan = new Map<string, PlanOperation>();
  const extra = new Map<string, ReturnType<typeof operationDurations> & { order: OrderRow }>();
  for (const op of machineOps) {
    const order = data.orders.get(op.orderId);
    if (!order) continue;
    const durations = operationDurations(op, Number(order.quantity), data.historicCycles);
    extra.set(op.id, { ...durations, order });
    plan.set(op.id, {
      id: op.id,
      orderId: op.orderId,
      sequence: op.sequence,
      machineId: op.machineId,
      planDay: op.planDay,
      position: op.position,
      addedAt: op.addedAt,
      priority: order.effectivePriority,
      dueDate: order.dueDate,
      status: op.status === "done" ? "ready" : op.status,
      plannedSeconds: durations.planned,
      actualSeconds: durations.actual,
      setupSeconds:
        op.status === "in_progress" || op.status === "paused" ? 0 : Math.round(op.setupMin * 60),
      workerIds: op.workers.map((w) => w.id),
    });
  }

  return { holidays, calendar, machineOps, plan, extra };
}

export function buildBoard(
  data: PlanningData,
  options: { from: string; days: number; today: string; basis: PlanBasis },
): BoardModel {
  const { from, today, basis } = options;
  const to = addDays(from, options.days - 1);
  const { holidays, calendar, machineOps, plan, extra } = buildBoardInputs(data);

  const label = (id: string) => {
    const op = data.operations.find((o) => o.id === id);
    const order = op ? data.orders.get(op.orderId) : undefined;
    return op && order ? `${order.orderNumber} · ${op.code}` : id;
  };

  const forecasts = new Map<string, OperationForecast>();
  const segments: ReturnType<typeof scheduleMachine>["segments"] = [];
  const machines: BoardMachine[] = data.machines.map((machine) => {
    const ops = [...plan.values()].filter(
      (op) => op.machineId === machine.id && op.planDay !== null,
    );
    const input = {
      machine,
      operations: ops,
      calendar,
      today,
      workHoursPerDay: data.workHoursPerDay,
      basis,
    };
    const schedule = scheduleMachine(input);
    for (const [id, forecast] of schedule.forecasts) forecasts.set(id, forecast);
    segments.push(...schedule.segments);

    const capacity = capacitySeconds(machine, data.workHoursPerDay);
    const days: BoardMachine["days"] = {};
    for (const day of dateRange(from, to)) {
      const load = schedule.days.get(day);
      const working = isWorkingDay(day, calendar);
      const down = calendar.downtimes.some(
        (d) =>
          d.machineId === machine.id && d.startsOn <= day && (d.endsOn === null || day <= d.endsOn),
      );
      days[day] = {
        ...(load ?? {
          capacity: down || (!working && !machine.runsUnattended) ? 0 : capacity,
          carriedIn: 0,
          planned: ops
            .filter((op) => op.planDay === day)
            .reduce(
              (sum, op) =>
                sum +
                (basis === "actual" ? (op.actualSeconds ?? op.plannedSeconds) : op.plannedSeconds),
              0,
            ),
          used: 0,
          working,
          down,
          overloaded: false,
        }),
        continuing: schedule.segments
          .filter((s) => s.day === day && !s.start)
          .map((s) => ({ id: s.operationId, label: label(s.operationId) })),
      };
    }

    const moves = rebalanceMachine(input);
    return {
      id: machine.id,
      code: machine.code,
      name: machine.name,
      typeName: machine.typeName,
      runsUnattended: machine.runsUnattended,
      capacityHours: capacity / HOUR,
      days,
      downtimes: data.downtimes.filter((d) => d.machineId === machine.id),
      proposal: moves
        .filter((move) => plan.get(move.operationId)?.planDay !== move.planDay)
        .map((move) => ({
          operationId: move.operationId,
          label: label(move.operationId),
          from: plan.get(move.operationId)?.planDay ?? null,
          to: move.planDay,
        })),
    };
  });

  // Order end = latest forecast end of its planned machine operations.
  const orderEnd = new Map<string, string | null>();
  for (const op of plan.values()) {
    if (op.planDay === null) continue;
    const end = forecasts.get(op.id)?.endDay ?? null;
    const known = orderEnd.get(op.orderId);
    if (known === null) continue;
    orderEnd.set(
      op.orderId,
      end === null ? null : known === undefined || end > known ? end : known,
    );
  }

  const cards: BoardCard[] = [];
  for (const op of machineOps) {
    const planned = plan.get(op.id);
    const info = extra.get(op.id);
    if (!planned || !info) continue;
    const { order } = info;
    const earlier = data.operations
      .filter((o) => o.orderId === op.orderId && o.sequence < op.sequence && !o.isInspection)
      .sort((a, b) => b.sequence - a.sequence);
    const previousMachine = earlier.find((o) => !o.isExternal);
    const previousPlan = previousMachine ? plan.get(previousMachine.id) : undefined;
    const external = earlier.find((o) => o.isExternal);
    const deviation =
      info.actualSource !== null && op.cycleSeconds && info.actualCycle !== null
        ? Math.round((info.actualCycle / op.cycleSeconds - 1) * 1000) / 10
        : null;
    cards.push({
      id: op.id,
      orderId: op.orderId,
      orderNumber: order.orderNumber,
      partNumber: order.product?.partNumber ?? "",
      productName: order.product?.name ?? "",
      customerName: order.customer?.name ?? null,
      code: op.code,
      name: op.name,
      sequence: op.sequence,
      quantity: order.quantity,
      unit: order.unit,
      status: op.status,
      priority: order.effectivePriority,
      manualPriority: order.priority,
      dueDate: order.dueDate,
      machineId: op.machineId,
      planDay: op.planDay,
      position: op.position,
      plannedSeconds: info.planned,
      actualSeconds: info.actual,
      actualSource: info.actualSource,
      deviationPercent: deviation,
      workers: op.workers,
      forecast: forecasts.get(op.id) ?? null,
      warnings: operationWarnings({
        op: planned,
        forecast: forecasts.get(op.id),
        orderEnd: orderEnd.get(op.orderId),
        previous: previousMachine
          ? {
              forecast: forecasts.get(previousMachine.id),
              planned: previousPlan?.planDay !== null && previousPlan !== undefined,
            }
          : null,
        today,
      }),
      waitingExternal: external
        ? {
            code: external.code,
            name: external.name,
            company: external.externalCompany,
            status: external.status,
          }
        : null,
    });
  }

  const load = operatorLoad({
    segments,
    operations: plan,
    unattended: (id) => data.machines.find((m) => m.id === id)?.runsUnattended ?? false,
  });
  const days = dateRange(from, to);
  const workers: BoardWorker[] = data.employees
    .filter((e) => !e.isInspector || e.machineIds.length > 0)
    .map((employee) => {
      const byDay = load.get(employee.id);
      return {
        id: employee.id,
        name: employee.name,
        machineIds: employee.machineIds,
        load: Object.fromEntries(days.map((day) => [day, byDay?.get(day) ?? 0])),
        absent: days.filter((day) =>
          data.absences.some(
            (a) =>
              a.employeeId === employee.id &&
              a.startDate <= day &&
              (a.endDate === null || day <= a.endDate),
          ),
        ),
      };
    });

  return {
    from,
    to,
    today,
    basis,
    workHoursPerDay: data.workHoursPerDay,
    days: days.map((date) => ({
      date,
      working: isWorkingDay(date, calendar),
      holiday: holidays.get(date) ?? null,
      today: date === today,
    })),
    machines,
    cards: cards.filter((card) => card.planDay !== null),
    unplanned: cards.filter((card) => card.planDay === null).sort((a, b) => unplannedOrder(a, b)),
    workers,
    reasons: data.reasons,
  };
}
