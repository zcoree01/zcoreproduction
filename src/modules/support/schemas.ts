import { z } from "zod";

// Zcore support access (D-026): platform admin asks, the organization
// (support.approve) approves for a limited time, ending removes all access.

/** Username of every organization's support account (valid usernameSchema). */
export const SUPPORT_USERNAME = "zcore-podrska";

export const SUPPORT_DURATIONS = [30, 60, 120, 240, 480] as const;

export const requestSupportSchema = z.object({
  organizationId: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
});

export const decideSupportSchema = z
  .object({
    requestId: z.uuid(),
    approve: z.boolean(),
    minutes: z.union(SUPPORT_DURATIONS.map((m) => z.literal(m))).nullable(),
    note: z.string().trim().max(1000),
  })
  .refine((value) => !value.approve || value.minutes !== null, { path: ["minutes"] });

export const SUPPORT_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "active",
  "ended",
  "cancelled",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const supportStatusSchema = z.enum(SUPPORT_STATUSES);

/** Approved or active access that has passed its end counts as ended. */
export function effectiveSupportStatus(
  status: SupportStatus,
  approvedUntil: string | null,
  now: Date = new Date(),
): SupportStatus {
  if ((status === "approved" || status === "active") && approvedUntil !== null) {
    return new Date(approvedUntil).getTime() <= now.getTime() ? "ended" : status;
  }
  return status;
}

/**
 * Address on which the support account signs in: the organization's own
 * subdomain in production; on dev / preview hosts the same host with ?org.
 */
export function supportEntryUrl(input: {
  protocol: string;
  host: string;
  slug: string;
  tokenHash: string;
  rootDomain: string;
}): string {
  const hostname = input.host.split(":")[0] ?? input.host;
  const params = new URLSearchParams({ token_hash: input.tokenHash });
  if (hostname === input.rootDomain || hostname.endsWith(`.${input.rootDomain}`)) {
    return `${input.protocol}//${input.slug}.${input.rootDomain}/support/enter?${params}`;
  }
  params.set("org", input.slug);
  return `${input.protocol}//${input.host}/support/enter?${params}`;
}
