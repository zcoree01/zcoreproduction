// Production order rules: order numbers, planned time, schedule slack,
// priority, due-date warnings and the bar calculation. Pure functions
// (unit-tested). The database computes the same values for lists and sorting
// (private.format_order_number, private.order_schedule).
import { addDecimals, compareDecimals, divideDecimal, toScaled } from "@/lib/decimal";
import { operationSeconds } from "@/modules/products/rules";
import type { OrderStatus } from "./status-rules";
import { CLOSED_STATUSES } from "./status-rules";

// ---------------------------------------------------------------------------
// Order numbers
// ---------------------------------------------------------------------------
export const DEFAULT_ORDER_NUMBER_TEMPLATE = "RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}";
export const DEFAULT_ORDER_NUMBER_DIGITS = 3;
export const ORDER_NUMBER_TOKENS = ["KUPAC", "SEDMICA", "GODINA", "GODINA4", "BROJ"] as const;
export type OrderNumberToken = (typeof ORDER_NUMBER_TOKENS)[number];

const TOKEN_PATTERN = /\{(KUPAC|SEDMICA|GODINA4|GODINA|BROJ)\}/g;

/**
 * Mirrors private.valid_order_number_template: 1–60 characters, contains
 * {BROJ} and a year (numbers restart every year), otherwise only letters,
 * digits, space and . / _ -.
 */
export function isValidOrderNumberTemplate(template: string): boolean {
  return (
    template.length >= 1 &&
    template.length <= 60 &&
    template.includes("{BROJ}") &&
    /\{GODINA4?\}/.test(template) &&
    /^[A-Za-z0-9./_ -]*$/.test(template.replace(TOKEN_PATTERN, ""))
  );
}

/** ISO 8601 week number (1–53) of a calendar date "YYYY-MM-DD". */
export function isoWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  // Thursday of the same week decides the week-based year.
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  return Math.ceil(((utc.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * Order number from the template, e.g. RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ} →
 * RN13-0526-358. {BROJ} is padded to `digits` and grows beyond it when needed.
 * `date` is the creation day in the organization's time zone.
 */
export function formatOrderNumber(
  template: string,
  digits: number,
  customerNumber: number,
  date: string,
  sequence: number,
): string {
  const year = date.slice(0, 4);
  const values: Record<OrderNumberToken, string> = {
    KUPAC: String(customerNumber),
    SEDMICA: String(isoWeek(date)).padStart(2, "0"),
    GODINA: year.slice(2),
    GODINA4: year,
    BROJ: String(sequence).padStart(digits, "0"),
  };
  return template.replace(TOKEN_PATTERN, (_, token: OrderNumberToken) => values[token]);
}

// ---------------------------------------------------------------------------
// Settings (organizations.settings)
// ---------------------------------------------------------------------------
export type PriorityMode = "manual" | "automatic";
export type PriorityThresholds = readonly [number, number, number, number];

export type OrderSettings = {
  numberTemplate: string;
  numberDigits: number;
  priorityMode: PriorityMode;
  /** Slack (days) up to which the priority is 1, 2, 3, 4; above: 5. */
  priorityThresholds: PriorityThresholds;
  /** Days before the due date that raise a warning while work has not started. */
  dueWarningDays: number[];
  /** Hours of work per day, for the slack calculation. */
  workHoursPerDay: number;
};

export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  numberTemplate: DEFAULT_ORDER_NUMBER_TEMPLATE,
  numberDigits: DEFAULT_ORDER_NUMBER_DIGITS,
  priorityMode: "manual",
  priorityThresholds: [0, 3, 7, 10],
  dueWarningDays: [10, 7, 3],
  workHoursPerDay: 8,
};

function intList(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item))
    ? (value as number[])
    : null;
}

/** Order settings from organizations.settings, defaults for missing values. */
export function orderSettingsFromSettings(settings: unknown): OrderSettings {
  const record =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const template = record.order_number_template;
  const digits = record.order_number_digits;
  const thresholds = intList(record.priority_thresholds);
  const warningDays = intList(record.due_warning_days);
  const hours = record.work_hours_per_day;
  return {
    numberTemplate:
      typeof template === "string" && isValidOrderNumberTemplate(template)
        ? template
        : DEFAULT_ORDER_SETTINGS.numberTemplate,
    numberDigits:
      typeof digits === "number" && Number.isInteger(digits) && digits >= 1 && digits <= 6
        ? digits
        : DEFAULT_ORDER_SETTINGS.numberDigits,
    priorityMode: record.priority_mode === "automatic" ? "automatic" : "manual",
    priorityThresholds:
      thresholds?.length === 4
        ? [thresholds[0] ?? 0, thresholds[1] ?? 3, thresholds[2] ?? 7, thresholds[3] ?? 10]
        : DEFAULT_ORDER_SETTINGS.priorityThresholds,
    dueWarningDays:
      warningDays && warningDays.length > 0 ? warningDays : DEFAULT_ORDER_SETTINGS.dueWarningDays,
    workHoursPerDay:
      typeof hours === "number" && hours >= 1 && hours <= 24
        ? hours
        : DEFAULT_ORDER_SETTINGS.workHoursPerDay,
  };
}

// ---------------------------------------------------------------------------
// Planned time
// ---------------------------------------------------------------------------
type TimedOperation = { setupTimeMin: string | null; cycleTimeS: string | null };

/** Planned seconds of one operation: setup once + quantity × cycle. */
export function plannedOperationSeconds(operation: TimedOperation, quantity: string): string {
  return operationSeconds(operation, quantity);
}

/** Planned seconds of an order: the sum of its operations. */
export function plannedOrderSeconds(operations: readonly TimedOperation[], quantity: string) {
  return addDecimals(operations.map((op) => plannedOperationSeconds(op, quantity)));
}

// ---------------------------------------------------------------------------
// Schedule: slack, priority, due-date warnings (mirror of private.order_schedule)
// ---------------------------------------------------------------------------

/** Whole days from `today` to `due` (both "YYYY-MM-DD"); negative when overdue. */
export function daysBetween(today: string, due: string): number {
  const toDay = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
  };
  return Math.round(toDay(due) - toDay(today));
}

/** Working days the remaining time needs (rounded up). */
export function daysNeeded(remainingSeconds: string, workHoursPerDay: number): number {
  const perDay = BigInt(workHoursPerDay * 3600) * 1000n;
  const remaining = toScaled(remainingSeconds, 3);
  if (remaining <= 0n) return 0;
  return Number((remaining + perDay - 1n) / perDay);
}

/** Days to spare: days to the due date minus the days the remaining work needs. */
export function slackDays(daysToDue: number, remainingSeconds: string, workHoursPerDay: number) {
  return daysToDue - daysNeeded(remainingSeconds, workHoursPerDay);
}

export type Priority = 1 | 2 | 3 | 4 | 5;
export const PRIORITIES: readonly Priority[] = [1, 2, 3, 4, 5];

/** 1 (extremely urgent) … 5 (not urgent) from the slack and the thresholds. */
export function computedPriority(slack: number, thresholds: PriorityThresholds): Priority {
  const index = thresholds.findIndex((limit) => slack <= limit);
  return (index === -1 ? 5 : index + 1) as Priority;
}

/** Manual priority wins; otherwise automatic (when enabled) or normal (3). */
export function effectivePriority(
  manual: number | null,
  mode: PriorityMode,
  computed: Priority,
): number {
  return manual ?? (mode === "automatic" ? computed : 3);
}

/** A manual priority that differs from the computed one (warn the planner). */
export function overridesComputedPriority(
  manual: number | null,
  mode: PriorityMode,
  computed: Priority,
): boolean {
  return mode === "automatic" && manual !== null && manual !== computed;
}

export type DueWarning =
  { kind: "overdue" } | { kind: "behind" } | { kind: "due_soon"; days: number };

/**
 * overdue: the due date has passed; behind: the remaining planned time does
 * not fit before the due date; due_soon: within a warning threshold (10/7/3
 * days) and work has not started. Closed orders have no warnings.
 */
export function dueWarning(input: {
  status: OrderStatus;
  daysToDue: number;
  slack: number;
  started: boolean;
  warningDays: readonly number[];
}): DueWarning | null {
  if (CLOSED_STATUSES.includes(input.status)) return null;
  if (input.daysToDue < 0) return { kind: "overdue" };
  if (input.slack < 0) return { kind: "behind" };
  if (input.started) return null;
  const reached = input.warningDays.filter((days) => input.daysToDue <= days);
  return reached.length > 0 ? { kind: "due_soon", days: Math.min(...reached) } : null;
}

// ---------------------------------------------------------------------------
// Bars: how many pieces one bar yields
// ---------------------------------------------------------------------------
export type BarPlan = {
  /** Usable length per bar (bar − remnant), mm. */
  usableLength: string;
  /** Material per piece (piece length + kerf), mm. */
  perPiece: string;
  piecesPerBar: number;
  /** Bars for the ordered quantity (pieces only). */
  barsNeeded: number | null;
};

/**
 * Pieces per bar = ⌊(bar length − remnant) / (piece length + kerf)⌋, e.g.
 * 3000 mm bar, 200 mm remnant, 30 mm pieces, 2 mm kerf → 87 pieces.
 * Null when a length is missing or nothing fits.
 */
export function barPlan(input: {
  barLength: string | null;
  remnant: string | null;
  pieceLength: string | null;
  kerf: string | null;
  quantity: string | null;
  wholePieces: boolean;
}): BarPlan | null {
  if (!input.barLength || !input.pieceLength) return null;
  const usableLength = addDecimals([input.barLength, `-${input.remnant ?? "0"}`], 3);
  const perPiece = addDecimals([input.pieceLength, input.kerf ?? "0"], 3);
  if (compareDecimals(usableLength, "0") <= 0 || compareDecimals(perPiece, "0") <= 0) return null;

  const piecesPerBar = Number(toScaled(usableLength, 3) / toScaled(perPiece, 3));
  if (piecesPerBar < 1) return null;

  let barsNeeded: number | null = null;
  if (input.wholePieces && input.quantity) {
    const pieces = BigInt(divideDecimal(input.quantity, "1", 0));
    const perBar = BigInt(piecesPerBar);
    barsNeeded = Number((pieces + perBar - 1n) / perBar);
  }
  return { usableLength, perPiece, piecesPerBar, barsNeeded };
}
