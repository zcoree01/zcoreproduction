// Product domain rules: revision labels, cycle-time units and durations,
// attachment files, history entries. Pure functions (unit-tested).
import { addDecimals, divideDecimal, multiplyDecimal, parseDecimal, toScaled } from "@/lib/decimal";

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

function nextLetters(letters: string): string {
  const chars = letters.split("");
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (chars[i] !== "Z") {
      chars[i] = String.fromCharCode((chars[i] ?? "A").charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[i] = "A";
  }
  return `A${chars.join("")}`;
}

/**
 * Suggested label after `current`: A → B, Z → AA, 01 → 02, A1 → A2.
 * Skips labels that already exist; null when no rule applies.
 */
export function nextRevisionLabel(
  current: string,
  existing: readonly string[] = [],
): string | null {
  const taken = new Set(existing.map((label) => label.toUpperCase()));
  const step = (label: string): string | null => {
    if (/^[A-Z]+$/.test(label)) return nextLetters(label);
    const digits = /^(.*?)(\d+)$/.exec(label);
    if (digits) {
      const [, prefix = "", number = ""] = digits;
      const next = (BigInt(number) + 1n).toString().padStart(number.length, "0");
      return `${prefix}${next}`;
    }
    return null;
  };

  let candidate = step(current.trim().toUpperCase());
  for (let guard = 0; candidate !== null && taken.has(candidate) && guard < 1000; guard += 1) {
    candidate = step(candidate);
  }
  return candidate !== null && candidate.length <= 10 ? candidate : null;
}

// ---------------------------------------------------------------------------
// Cycle times (stored in seconds) and durations
// ---------------------------------------------------------------------------
export type TimeUnit = "min" | "s";

export function minutesToSeconds(minutes: string): string {
  return multiplyDecimal(minutes, "60");
}

/** Seconds → display value in `unit` (minutes rounded to 3 decimals). */
export function secondsToUnit(seconds: string, unit: TimeUnit): string {
  return unit === "s" ? (parseDecimal(seconds, 6) ?? seconds) : divideDecimal(seconds, "60", 3);
}

/** Unit for an operation: the machine's own unit, otherwise the organization default. */
export function resolveCycleUnit(machineUnit: TimeUnit | null, orgDefault: TimeUnit): TimeUnit {
  return machineUnit ?? orgDefault;
}

/** Organization default from organizations.settings (minutes unless set to seconds). */
export function cycleUnitFromSettings(settings: unknown): TimeUnit {
  const value =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).cycle_time_unit
      : undefined;
  return value === "s" ? "s" : "min";
}

type TimedOperation = { setupTimeMin: string | null; cycleTimeS: string | null };

/** Seconds for one operation over `quantity` pieces: setup once + cycle × quantity. */
export function operationSeconds(operation: TimedOperation, quantity: string): string {
  const setup = operation.setupTimeMin ? minutesToSeconds(operation.setupTimeMin) : "0";
  const cycle = operation.cycleTimeS ? multiplyDecimal(operation.cycleTimeS, quantity) : "0";
  return addDecimals([setup, cycle]);
}

/** Totals of a routing: setup (once) and cycle time per piece, in seconds. */
export function routingTotals(operations: readonly TimedOperation[]) {
  return {
    setupSeconds: addDecimals(
      operations.map((op) => (op.setupTimeMin ? minutesToSeconds(op.setupTimeMin) : "0")),
    ),
    cycleSecondsPerPiece: addDecimals(operations.map((op) => op.cycleTimeS ?? "0")),
  };
}

/** Whole hours, minutes and seconds (rounded) of a seconds value, for display. */
export function splitDuration(seconds: string): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const total = Number((toScaled(seconds, 3) + 500n) / 1000n);
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** Storage object path: <organization>/<product>/<file id>.<ext>. */
export function attachmentStoragePath(
  organizationId: string,
  productId: string,
  fileId: string,
  extension: string,
): string {
  return `${organizationId}/${productId}/${fileId}.${extension}`;
}

/** True when `path` lies in the folder of this organization's product. */
export function isProductStoragePath(path: string, organizationId: string, productId: string) {
  return new RegExp(`^${organizationId}/${productId}/[0-9a-f-]{36}\\.(pdf|png|jpg|webp)$`).test(
    path,
  );
}

// ---------------------------------------------------------------------------
// History (audit_log entries of a product)
// ---------------------------------------------------------------------------
export type HistoryEvent =
  | "product_created"
  | "product_updated"
  | "product_archived"
  | "product_restored"
  | "product_copied"
  | "revision_added"
  | "revision_updated"
  | "revision_created"
  | "revision_restored"
  | "operation_added"
  | "operation_updated"
  | "operation_archived"
  | "operation_restored"
  | "attachment_added"
  | "attachment_updated"
  | "attachment_archived"
  | "attachment_restored";

export type HistoryEntryInput = {
  action: string;
  entityType: string;
  before: unknown;
  after: unknown;
};

export type HistoryDescription = {
  event: HistoryEvent;
  /** Changed columns (updates only). */
  fields: string[];
  /** Revision label, operation number or file name the entry is about. */
  subject: string | null;
};

const IGNORED_FIELDS = new Set([
  "id",
  "organization_id",
  "created_at",
  "updated_at",
  "created_by",
  "product_type_kind",
  "material_shape_kind",
  "machine_type_kind",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Columns whose value differs between two audit snapshots. */
export function changedFields(before: unknown, after: unknown): string[] {
  const a = asRecord(before);
  const b = asRecord(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !IGNORED_FIELDS.has(key))
    .filter((key) => JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null))
    .sort();
}

function text(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

/**
 * What an audit entry means for the product history, or null for entries that
 * are only bookkeeping (switching the current revision flag, untouched rows).
 */
export function describeHistoryEntry(entry: HistoryEntryInput): HistoryDescription | null {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  const fields = changedFields(entry.before, entry.after);
  const archivedChange = fields.includes("archived_at");
  const archiveEvent = after.archived_at ? "archived" : "restored";

  switch (entry.action) {
    case "products.revision_created":
      return { event: "revision_created", fields: [], subject: text(after.revision) };
    case "products.revision_restored":
      return { event: "revision_restored", fields: [], subject: text(after.revision) };
    case "products.copied":
      return { event: "product_copied", fields: [], subject: text(before.part_number) };
    case "products.insert":
      return { event: "product_created", fields: [], subject: text(after.part_number) };
    case "products.update":
      if (fields.length === 0) return null;
      return archivedChange
        ? { event: `product_${archiveEvent}`, fields: [], subject: text(after.part_number) }
        : { event: "product_updated", fields, subject: text(after.part_number) };
    case "product_revisions.insert":
      return { event: "revision_added", fields: [], subject: text(after.revision) };
    case "product_revisions.update": {
      const changed = fields.filter((field) => field !== "is_current");
      if (changed.length === 0) return null;
      return { event: "revision_updated", fields: changed, subject: text(after.revision) };
    }
    case "product_operations.insert":
      return { event: "operation_added", fields: [], subject: text(after.sequence) };
    case "product_operations.update":
      if (fields.length === 0) return null;
      return archivedChange
        ? { event: `operation_${archiveEvent}`, fields: [], subject: text(after.sequence) }
        : { event: "operation_updated", fields, subject: text(after.sequence) };
    case "product_attachments.insert":
      return { event: "attachment_added", fields: [], subject: text(after.file_name) };
    case "product_attachments.update":
      if (fields.length === 0) return null;
      return archivedChange
        ? { event: `attachment_${archiveEvent}`, fields: [], subject: text(after.file_name) }
        : { event: "attachment_updated", fields, subject: text(after.file_name) };
    default:
      return null;
  }
}
