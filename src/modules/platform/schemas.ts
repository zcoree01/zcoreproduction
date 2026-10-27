import { z } from "zod";

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
