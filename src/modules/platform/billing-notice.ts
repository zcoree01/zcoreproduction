import { z } from "zod";

// The organization's billing state as its members see it (my_billing_notice,
// D-049): no amounts; the warning only for those who manage its settings.

export type BillingNotice = {
  state: "active" | "trial" | "warning" | "overdue" | "locked";
  /** First day of the unpaid month. */
  unpaidPeriod: string | null;
  /** The day the lock starts (warning) or started (locked for non-payment). */
  lockOn: string | null;
  reason: "manual" | "unpaid" | null;
  /** Whom to contact, from the platform settings. */
  contact: string;
};

const noticeSchema = z.object({
  state: z.enum(["active", "trial", "warning", "overdue", "locked"]),
  unpaid_period: z.string().nullable(),
  lock_on: z.string().nullable(),
  reason: z.enum(["manual", "unpaid"]).nullable(),
  contact: z.string(),
});

const NO_NOTICE: BillingNotice = {
  state: "active",
  unpaidPeriod: null,
  lockOn: null,
  reason: null,
  contact: "",
};

export function parseBillingNotice(value: unknown): BillingNotice {
  const parsed = noticeSchema.safeParse(value);
  if (!parsed.success) return NO_NOTICE;
  return {
    state: parsed.data.state,
    unpaidPeriod: parsed.data.unpaid_period,
    lockOn: parsed.data.lock_on,
    reason: parsed.data.reason,
    contact: parsed.data.contact,
  };
}
