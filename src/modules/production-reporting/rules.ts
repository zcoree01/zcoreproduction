import { addDecimals, compareDecimals, fromScaled, toScaled } from "@/lib/decimal";

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
