import { addDecimals, compareDecimals, divideDecimal, fromScaled, toScaled } from "@/lib/decimal";

// Quantity rules of production reporting. The database enforces the same
// (report_operation_quantity in migration 20261026100000); this copy gives
// the floor screens their numbers and messages before anything is sent.

/** Pieces not reported yet: what reached the operation minus good and scrap (never below 0). */
export function remainingQuantity(input: string, good: string, scrap: string): string {
  const rest = toScaled(input, 3) - toScaled(good, 3) - toScaled(scrap, 3);
  return fromScaled(rest > 0n ? rest : 0n, 3);
}

export type ReportCheck = {
  /** Pieces that reached the operation. */
  input: string;
  /** Already reported (not voided) on this operation. */
  reportedGood: string;
  reportedScrap: string;
  /** This report. */
  good: string;
  scrap: string;
  wholePieces: boolean;
  finish: boolean;
};

export type ReportProblem =
  "quantity_required" | "whole_pieces_required" | "quantity_exceeds_input" | "nothing_reported";

function isWhole(value: string): boolean {
  return !value.includes(".");
}

/** First rule a report breaks, or null when the database will accept it. */
export function reportProblem(check: ReportCheck): ReportProblem | null {
  const thisReport = addDecimals([check.good, check.scrap], 3);
  if (compareDecimals(thisReport, "0") === 0 && !check.finish) return "quantity_required";
  if (check.wholePieces && (!isWhole(check.good) || !isWhole(check.scrap))) {
    return "whole_pieces_required";
  }
  const total = addDecimals([check.reportedGood, check.reportedScrap, thisReport], 3);
  if (compareDecimals(total, check.input) > 0) return "quantity_exceeds_input";
  if (check.finish && compareDecimals(total, "0") === 0) return "nothing_reported";
  return null;
}

/** Finishing leaves pieces unreported (they reached the operation but are neither good nor scrap). */
export function unreportedOnFinish(check: Omit<ReportCheck, "finish">): string {
  return remainingQuantity(
    check.input,
    addDecimals([check.reportedGood, check.good], 3),
    addDecimals([check.reportedScrap, check.scrap], 3),
  );
}

/** Fewer good pieces than ordered: closing needs an approved request. */
export function hasShortage(goodQuantity: string, ordered: string): boolean {
  return compareDecimals(goodQuantity, ordered) < 0;
}

/** What a worker may do on an operation, from floor_operation_work. */
export type WorkBlock =
  | "operation_external"
  | "cutting_uses_material_status"
  | "not_an_employee"
  | "not_assigned"
  | "order_closed"
  | "operation_done"
  | "order_paused"
  | "order_not_ready"
  | "not_arrived";

export type WorkButtons = { start: boolean; pause: boolean; report: boolean; finish: boolean };

/**
 * Buttons on the floor screen. Start continues as well; reporting and finishing
 * need the operation to have been started (by anyone).
 */
export function workButtons(state: {
  blocked: WorkBlock | null;
  working: boolean;
  operationStatus: "waiting" | "ready" | "in_progress" | "paused" | "done";
}): WorkButtons {
  const started = state.operationStatus === "in_progress" || state.operationStatus === "paused";
  // Started operations can still be reported and finished while the order is
  // paused or not arrived any more; closed / foreign ones cannot.
  const hardBlock =
    state.blocked !== null &&
    state.blocked !== "order_paused" &&
    state.blocked !== "not_arrived" &&
    state.blocked !== "order_not_ready";
  return {
    start: state.blocked === null && !state.working,
    pause: !hardBlock && state.working,
    report: !hardBlock && started,
    finish: !hardBlock && started,
  };
}

/**
 * Actual cycle time per piece in seconds: machine running time minus the
 * planned setup, divided by the reported pieces (good + scrap). Null without
 * pieces. Shown next to the planned cycle from the routing.
 */
export function actualCycleSeconds(op: {
  runSeconds: string;
  setupTimeMin: string | null;
  goodQuantity: string;
  scrapQuantity: string;
}): string | null {
  const pieces = addDecimals([op.goodQuantity, op.scrapQuantity], 3);
  if (compareDecimals(pieces, "0") <= 0) return null;
  const setup = toScaled(op.setupTimeMin ?? "0", 3) * 60n;
  const working = toScaled(op.runSeconds, 3) - setup;
  if (working <= 0n) return "0";
  return divideDecimal(fromScaled(working, 3), pieces, 1);
}

/** Actual vs planned cycle in percent (+12 = 12 % slower), one decimal; null when unknown. */
export function cycleDeviationPercent(
  actual: string | null,
  planned: string | null,
): string | null {
  if (actual === null || planned === null || compareDecimals(planned, "0") <= 0) return null;
  const ratio = divideDecimal(actual, planned, 6);
  return divideDecimal(addDecimals([ratio, "-1"], 6), "0.01", 1);
}

/** Scrap rate in percent of reported pieces, one decimal; null without pieces. */
export function scrapRatePercent(good: string, scrap: string): string | null {
  const pieces = addDecimals([good, scrap], 3);
  if (compareDecimals(pieces, "0") <= 0) return null;
  return divideDecimal(addDecimals([scrap], 3), divideDecimal(pieces, "100", 6), 1);
}

/** Downtime summed per reason, longest first. */
export function downtimeByReason(
  events: readonly { reason: string; seconds: string }[],
): { reason: string; seconds: string; count: number }[] {
  const totals = new Map<string, { seconds: string; count: number }>();
  for (const event of events) {
    const current = totals.get(event.reason) ?? { seconds: "0", count: 0 };
    totals.set(event.reason, {
      seconds: addDecimals([current.seconds, event.seconds], 3),
      count: current.count + 1,
    });
  }
  return [...totals.entries()]
    .map(([reason, total]) => ({ reason, ...total }))
    .sort((a, b) => compareDecimals(b.seconds, a.seconds) || a.reason.localeCompare(b.reason));
}

/**
 * Scrap rate of an order: all scrap divided by the pieces that entered
 * production (good + scrap reported on the first operation with reports,
 * usually the cut pieces). Voided reports are left out by the caller.
 */
export function orderScrapRatePercent(
  reports: readonly { operationSequence: number; good: string; scrap: string }[],
): string | null {
  if (reports.length === 0) return null;
  const first = Math.min(...reports.map((row) => row.operationSequence));
  const started = reports.filter((row) => row.operationSequence === first);
  const entered = addDecimals(
    started.flatMap((row) => [row.good, row.scrap]),
    3,
  );
  if (compareDecimals(entered, "0") <= 0) return null;
  const scrap = addDecimals(
    reports.map((row) => row.scrap),
    3,
  );
  return divideDecimal(scrap, divideDecimal(entered, "100", 6), 1);
}
