import { z } from "zod";
import { parseDecimal } from "@/lib/decimal";
import { SELLABLE_MODULES } from "./modules";

/**
 * Module of an organization: on / off and optionally until a day (trial).
 * `activeUntil` is a calendar day (YYYY-MM-DD); the module stays on through
 * that day in the platform's time zone (end of day, Europe/Sarajevo).
 */
export const setModuleSchema = z.object({
  organizationId: z.uuid(),
  module: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  enabled: z.boolean(),
  activeUntil: z.union([z.literal(""), z.iso.date()]).transform((value) => value || null),
});

export type SetModuleInput = z.infer<typeof setModuleSchema>;

export const trialDaysSchema = z.coerce.number().int().min(1).max(365);

/** Status of a module for display: off, on, trial (with days left), expired. */
export function moduleState(
  module: { enabled: boolean; activeUntil: string | null },
  now: Date = new Date(),
): { state: "off" | "on" | "trial" | "expired"; daysLeft: number | null } {
  if (!module.enabled) return { state: "off", daysLeft: null };
  if (module.activeUntil === null) return { state: "on", daysLeft: null };
  const until = new Date(module.activeUntil).getTime();
  if (until <= now.getTime()) return { state: "expired", daysLeft: 0 };
  return { state: "trial", daysLeft: Math.ceil((until - now.getTime()) / 86_400_000) };
}

// ---------------------------------------------------------------------------
// Billing (D-049)
// ---------------------------------------------------------------------------

const monthStart = z.iso.date().refine((value) => value.endsWith("-01"), "first day of a month");

/** A month paid (with the day of payment) or not paid any more. */
export const setPaymentSchema = z
  .object({
    organizationId: z.uuid(),
    period: monthStart,
    paid: z.boolean(),
    paidOn: z.union([z.literal(""), z.iso.date()]),
    note: z.string().max(200),
  })
  .refine((value) => !value.paid || value.paidOn !== "", { path: ["paidOn"] });

export const setLockSchema = z
  .object({
    organizationId: z.uuid(),
    locked: z.boolean(),
    reason: z.string(),
  })
  .refine(
    (value) =>
      !value.locked || (value.reason.trim().length >= 1 && value.reason.trim().length <= 300),
    {
      path: ["reason"],
    },
  );

export const assignPackageSchema = z.object({
  organizationId: z.uuid(),
  packageId: z.union([z.literal(""), z.uuid()]).transform((value) => value || null),
});

/** Grace days of one firm; empty = the platform default. */
export const orgBillingSchema = z.object({
  organizationId: z.uuid(),
  graceDays: z
    .string()
    .transform((value) => (value.trim() === "" ? null : Number(value)))
    .pipe(z.number().int().min(0).max(90).nullable()),
  autoLock: z.boolean(),
});

/** Keeps an overdue firm open through a day (empty = no longer). */
export const unlockUntilSchema = z.object({
  organizationId: z.uuid(),
  until: z.union([z.literal(""), z.iso.date()]).transform((value) => value || null),
});

export const OVERVIEW_FILTERS = [
  "all",
  "late",
  "locked",
  "trial",
  "archived",
  "purge_failed",
] as const;
export type OverviewFilter = (typeof OVERVIEW_FILTERS)[number];

export function overviewFilter(value: string | undefined): OverviewFilter {
  return OVERVIEW_FILTERS.find((filter) => filter === value) ?? "all";
}

/** Archive of a firm needs a reason; deletion needs the exact name typed again. */
export const archiveOrganizationSchema = z.object({
  orgId: z.uuid(),
  reason: z.string().trim().min(1).max(300),
});

export const deleteOrganizationSchema = z.object({
  orgId: z.uuid(),
  confirmName: z.string().min(1).max(200),
});

export const orgIdSchema = z.object({ orgId: z.uuid() });

/** A package: name, monthly price in KM (up to 2 decimals) and sellable modules. */
export const packageSchema = z.object({
  name: z.string().trim().min(1).max(80),
  monthlyPrice: z
    .string()
    .transform((value) => parseDecimal(value, 2))
    .refine((value): value is string => value !== null && !value.startsWith("-")),
  modules: z.array(z.enum(SELLABLE_MODULES)),
});

export const billingSettingsSchema = z.object({
  graceDays: z.coerce.number().int().min(0).max(90),
  warningDays: z.coerce.number().int().min(0).max(30),
  contact: z.string().trim().max(300),
});

export type ModuleDependency = { module: string; requires: string };

/**
 * Checkbox rule of the package form: checking a module checks what it needs,
 * unchecking one unchecks the modules that need it (repeated through chains).
 */
export function toggleModule(
  selected: readonly string[],
  key: string,
  checked: boolean,
  dependencies: readonly ModuleDependency[],
): string[] {
  const next = new Set(selected);
  const add = (module: string) => {
    if (next.has(module)) return;
    next.add(module);
    for (const d of dependencies) if (d.module === module) add(d.requires);
  };
  const remove = (module: string) => {
    if (!next.delete(module)) return;
    for (const d of dependencies) if (d.requires === module) remove(d.module);
  };
  if (checked) add(key);
  else remove(key);
  return [...next];
}

/**
 * Paid modules a firm loses when it gets `packageModules` (null = no package):
 * enabled ones without a trial end that the new package does not contain
 * (platform_assign_package switches them off; the screen warns first).
 */
export function modulesLost(
  modules: readonly { key: string; enabled: boolean; activeUntil: string | null }[],
  packageModules: readonly string[] | null,
): string[] {
  return modules
    .filter(
      (m) =>
        m.enabled &&
        m.activeUntil === null &&
        m.key !== "core" &&
        m.key !== "platform" &&
        !(packageModules ?? []).includes(m.key),
    )
    .map((m) => m.key);
}
