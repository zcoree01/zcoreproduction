"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, dbErrorKind, invalidFields } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCompany } from "./queries";
import {
  changeRequestSchema,
  COMPANY_FIELD_KEYS,
  companyProfileSchema,
  decisionSchema,
  toBankAccountsJson,
  toCompanyFieldsJson,
  type Company,
} from "./schemas";

export type SaveProfileResult =
  | { ok: true; status: "owned" | "claim_pending" }
  | {
      ok: false;
      error: "invalid" | "denied" | "company_owned" | "tax_id_taken" | "unexpected";
      fields: string[];
    };

/**
 * Own company data (org.settings.manage). A tax id that already exists in the
 * directory without an owner becomes a claim for the Zcore platform admin.
 */
export async function saveOrganizationProfileAction(input: unknown): Promise<SaveProfileResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "org.settings.manage"))) {
    return { ok: false, error: "denied", fields: [] };
  }
  const parsed = companyProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_organization_profile", {
    p_org_id: organizationId,
    p_country: parsed.data.country,
    p_tax_id: parsed.data.taxId,
    p_fields: toCompanyFieldsJson(parsed.data),
    p_bank_accounts: toBankAccountsJson(parsed.data.bankAccounts),
  });
  if (error) {
    if (error.message.includes("company_owned")) {
      return { ok: false, error: "company_owned", fields: ["taxId"] };
    }
    if (dbErrorKind(error) === "unique")
      return { ok: false, error: "tax_id_taken", fields: ["taxId"] };
    if (dbErrorKind(error) === "denied") return { ok: false, error: "denied", fields: [] };
    console.error("saveOrganizationProfileAction failed", error);
    return { ok: false, error: "unexpected", fields: [] };
  }
  revalidatePath("/", "layout");
  return { ok: true, status: data === "claim_pending" ? "claim_pending" : "owned" };
}

export type CompanySuggestion = {
  id: string;
  name: string;
  city: string | null;
  country: string;
  taxId: string;
};

/**
 * Suggestions while typing a customer's name or tax id: nothing below three
 * characters, at most eight hits (the directory is not browsable).
 */
export async function searchCompaniesAction(query: unknown): Promise<CompanySuggestion[]> {
  await requireMember();
  const parsed = z.string().trim().min(3).max(100).safeParse(query);
  if (!parsed.success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_companies", { p_query: parsed.data });
  if (error) {
    console.error("searchCompaniesAction failed", error);
    return [];
  }
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    country: row.country,
    taxId: row.tax_id,
  }));
}

export async function getCompanyAction(companyId: unknown): Promise<Company | null> {
  await requireMember();
  const parsed = z.uuid().safeParse(companyId);
  if (!parsed.success) return null;
  return getCompany(parsed.data);
}

const fail = actionFail<"changes" | "reason", never>;

/** Proposal to correct a directory entry the organization has as a customer. */
export async function requestCompanyChangeAction(input: unknown) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "customers.manage"))) return fail("denied");
  const parsed = changeRequestSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, ["changes", "reason"]));

  const changes = Object.fromEntries(
    Object.entries(parsed.data.changes).map(([field, value]) => [
      COMPANY_FIELD_KEYS[field as keyof typeof COMPANY_FIELD_KEYS],
      value ?? "",
    ]),
  );
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_company_change", {
    p_org_id: organizationId,
    p_company_id: parsed.data.companyId,
    p_changes: changes,
    p_reason: parsed.data.reason,
  });
  if (error) {
    if (dbErrorKind(error) === "denied") return fail("denied");
    console.error("requestCompanyChangeAction failed", error);
    return fail("unexpected");
  }
  revalidatePath("/customers", "layout");
  revalidatePath("/settings/company");
  return { ok: true as const, id: data };
}

/** Owner organization (own entry) or the platform admin (entries without owner, claims). */
export async function decideCompanyChangeAction(input: unknown) {
  const member = await requireMember();
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return actionFail<"note">("invalid", invalidFields(parsed.error, ["note"]));
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_company_change", {
    p_org_id: member.organization.id,
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note,
  });
  if (error) {
    const kind = dbErrorKind(error);
    if (kind === "denied") return actionFail<"note">("denied");
    if (kind === "not_found") return actionFail<"note">("not_found");
    console.error("decideCompanyChangeAction failed", error);
    return actionFail<"note">("unexpected");
  }
  revalidatePath("/settings/company");
  revalidatePath("/platform", "layout");
  revalidatePath("/customers", "layout");
  return { ok: true as const, id: parsed.data.requestId };
}
