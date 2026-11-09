import { z } from "zod";
import { toScaled } from "@/lib/decimal";

// Zcore platform home (public.platform_home()). Money stays a string with two
// decimals; dates are 'YYYY-MM-DD'. `revenue` is null without platform.revenue.read.

const money = z.string();
const count = z.number().int();

export const platformHomeSchema = z.object({
  today: z.string(),
  firms: z.object({
    using: count,
    using_last_month: count,
    trial: count,
    active: count,
    warning: count,
    overdue: count,
    locked: count,
  }),
  users: count,
  todo: z.object({
    directory_requests: count,
    support_pending: count,
    trials_ending: count,
    deletions_scheduled: count,
  }),
  overdue: z.array(
    z.object({
      organization_id: z.string(),
      name: z.string(),
      package_name: z.string().nullable(),
      period: z.string(),
      amount: money,
      days_late: count,
      state: z.string(),
    }),
  ),
  revenue: z
    .object({
      paid: money,
      expected: money,
      overdue_total: money,
      by_month: z.array(z.object({ period: z.string(), paid: money })),
    })
    .nullable(),
});

export type PlatformHome = z.infer<typeof platformHomeSchema>;

/** Whole percent (0–100, rounded down) of `paid` against `expected`. */
export function revenueProgress(paid: string, expected: string): number {
  const scale = 2;
  const total = toScaled(expected, scale);
  if (total <= 0n) return 0;
  const percent = (toScaled(paid, scale) * 100n) / total;
  if (percent <= 0n) return 0;
  return percent >= 100n ? 100 : Number(percent);
}

export function firmTrend(
  now: number,
  lastMonth: number,
): { delta: number; direction: "up" | "down" | "same" } {
  const delta = now - lastMonth;
  return { delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "same" };
}

const SLICE_KEYS = ["active", "trial", "warning", "overdue", "locked"] as const;

export function stateSlices(
  firms: PlatformHome["firms"],
): { key: (typeof SLICE_KEYS)[number]; value: number }[] {
  return SLICE_KEYS.map((key) => ({ key, value: firms[key] })).filter((slice) => slice.value > 0);
}
