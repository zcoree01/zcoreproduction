import { zonedDate } from "@/lib/timezone";

/** Window of the "Probe ističu" tile and filter: today and the next 7 days. */
export const TRIAL_ENDING_DAYS = 7;

type FirmModules = {
  id: string;
  modules: { enabled: boolean; activeUntil: string | null }[];
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Firms with an enabled module whose trial ends from today through today +
 * TRIAL_ENDING_DAYS, dates in `timeZone` (the Zcore organization's). Mirrors
 * todo.trials_ending in public.platform_home(), so the tile and the list agree.
 * Archived and platform firms are filtered by the caller.
 */
export function trialsEndingIds(firms: FirmModules[], now: Date, timeZone: string): Set<string> {
  const today = zonedDate(now, timeZone);
  const last = addDays(today, TRIAL_ENDING_DAYS);
  const ids = new Set<string>();
  for (const firm of firms) {
    const ending = firm.modules.some((module) => {
      if (!module.enabled || module.activeUntil === null) return false;
      const day = zonedDate(new Date(module.activeUntil), timeZone);
      return day >= today && day <= last;
    });
    if (ending) ids.add(firm.id);
  }
  return ids;
}
