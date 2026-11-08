import "server-only";
import { z } from "zod";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";

// Platform billing (D-049): packages, months and the computed state of each
// firm. Only the platform admin can call these RPCs (checked in the database).

export const BILLING_STATES = ["trial", "active", "warning", "overdue", "locked"] as const;
export type BillingState = (typeof BILLING_STATES)[number];

const stateSchema = z.enum(BILLING_STATES);
const numeric = z.union([z.number(), z.string()]).nullable();

export type BillingOverviewRow = {
  organizationId: string;
  name: string;
  slug: string;
  packageName: string | null;
  monthlyPrice: string | null;
  state: BillingState;
  lastPaidPeriod: string | null;
  memberCount: number;
  archived: boolean;
};

export async function listBillingOverview(): Promise<BillingOverviewRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_billing_overview");
  if (error) throw error;
  return data.map((row) => ({
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    packageName: row.package_name,
    monthlyPrice: decimalFromDb(row.monthly_price),
    state: stateSchema.catch("active").parse(row.state),
    lastPaidPeriod: row.last_paid_period,
    memberCount: row.member_count,
    archived: row.archived,
  }));
}

const detailSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    created_at: z.string(),
    archived: z.boolean(),
    member_count: z.number(),
    tax_id: z.string().nullable(),
    city: z.string().nullable(),
  }),
  package: z.object({ id: z.string(), name: z.string(), monthly_price: numeric }).nullable(),
  grace_days: z.number().nullable(),
  effective_grace_days: z.number(),
  auto_lock: z.boolean(),
  locked_at: z.string().nullable(),
  locked_reason: z.string().nullable(),
  unlocked_until: z.string().nullable(),
  state: stateSchema,
  reason: z.enum(["manual", "unpaid"]).nullable(),
  unpaid_period: z.string().nullable(),
  lock_on: z.string().nullable(),
  months: z.array(
    z.object({
      period: z.string(),
      package_name: z.string(),
      amount: numeric,
      due_on: z.string(),
      paid_on: z.string().nullable(),
      note: z.string().nullable(),
      state: z.enum(["paid", "pending", "unpaid"]),
    }),
  ),
  modules: z.array(
    z.object({
      key: z.string(),
      enabled: z.boolean(),
      active_until: z.string().nullable(),
      source: z.enum(["package", "trial", "manual", "off"]),
    }),
  ),
  history: z.array(
    z.object({
      created_at: z.string(),
      action: z.string(),
      actor: z.string().nullable(),
      before: z.unknown(),
      after: z.unknown(),
    }),
  ),
});

export type BillingMonth = {
  period: string;
  packageName: string;
  amount: string | null;
  dueOn: string;
  paidOn: string | null;
  note: string | null;
  state: "paid" | "pending" | "unpaid";
};

export type OrganizationBilling = {
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    createdAt: string;
    archived: boolean;
    memberCount: number;
    taxId: string | null;
    city: string | null;
  };
  package: { id: string; name: string; monthlyPrice: string | null } | null;
  graceDays: number | null;
  effectiveGraceDays: number;
  autoLock: boolean;
  lockedAt: string | null;
  lockedReason: string | null;
  unlockedUntil: string | null;
  state: BillingState;
  reason: "manual" | "unpaid" | null;
  unpaidPeriod: string | null;
  lockOn: string | null;
  months: BillingMonth[];
  modules: {
    key: string;
    enabled: boolean;
    activeUntil: string | null;
    source: "package" | "trial" | "manual" | "off";
  }[];
  history: { createdAt: string; action: string; actor: string | null }[];
};

export async function getOrganizationBilling(id: string): Promise<OrganizationBilling | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_organization_billing", { p_org_id: id });
  if (error) {
    if (error.code === "P0002") return null;
    throw error;
  }
  const d = detailSchema.parse(data);
  return {
    organization: {
      id: d.organization.id,
      name: d.organization.name,
      slug: d.organization.slug,
      timezone: d.organization.timezone,
      createdAt: d.organization.created_at,
      archived: d.organization.archived,
      memberCount: d.organization.member_count,
      taxId: d.organization.tax_id,
      city: d.organization.city,
    },
    package: d.package
      ? {
          id: d.package.id,
          name: d.package.name,
          monthlyPrice: decimalFromDb(d.package.monthly_price),
        }
      : null,
    graceDays: d.grace_days,
    effectiveGraceDays: d.effective_grace_days,
    autoLock: d.auto_lock,
    lockedAt: d.locked_at,
    lockedReason: d.locked_reason,
    unlockedUntil: d.unlocked_until,
    state: d.state,
    reason: d.reason,
    unpaidPeriod: d.unpaid_period,
    lockOn: d.lock_on,
    months: d.months.map((m) => ({
      period: m.period,
      packageName: m.package_name,
      amount: decimalFromDb(m.amount),
      dueOn: m.due_on,
      paidOn: m.paid_on,
      note: m.note,
      state: m.state,
    })),
    modules: d.modules.map((m) => ({
      key: m.key,
      enabled: m.enabled,
      activeUntil: m.active_until,
      source: m.source,
    })),
    history: d.history.map((h) => ({ createdAt: h.created_at, action: h.action, actor: h.actor })),
  };
}

export type BillingPackage = {
  id: string;
  name: string;
  monthlyPrice: string | null;
  modules: string[];
  archived: boolean;
  organizationCount: number;
};

const packagesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    monthly_price: numeric,
    modules: z.array(z.string()),
    archived: z.boolean(),
    organization_count: z.number(),
  }),
);

export async function listBillingPackages(): Promise<BillingPackage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_billing_packages");
  if (error) throw error;
  return packagesSchema.parse(data).map((p) => ({
    id: p.id,
    name: p.name,
    monthlyPrice: decimalFromDb(p.monthly_price),
    modules: p.modules,
    archived: p.archived,
    organizationCount: p.organization_count,
  }));
}
