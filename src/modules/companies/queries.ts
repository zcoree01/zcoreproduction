import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { companyJsonSchema, companyRawSchema, type Company } from "./schemas";

export type OrganizationProfile =
  | { status: "owned"; company: Company }
  | { status: "claim_pending"; company: Omit<Company, "id" | "registered">; requestedAt: string }
  | { status: "none" };

const pendingCompanySchema = companyRawSchema.omit({ id: true, registered: true }).partial({
  vat_id: true,
  short_name: true,
  legal_form: true,
  address: true,
  postal_code: true,
  city: true,
  mail_address: true,
  mail_postal_code: true,
  mail_city: true,
  phone: true,
  email: true,
  website: true,
  activity: true,
});

const emptyToNull = (value: string | null | undefined) => (value ? value : null);

/** The organization's own company data (or its pending claim). */
export async function getOrganizationProfile(organizationId: string): Promise<OrganizationProfile> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("organization_profile", { p_org_id: organizationId });
  if (error) throw error;
  const raw = z.object({ status: z.string() }).loose().parse(data);

  if (raw.status === "owned") {
    return { status: "owned", company: companyJsonSchema.parse(raw.company) };
  }
  if (raw.status === "claim_pending") {
    const pending = pendingCompanySchema.parse(raw.company);
    return {
      status: "claim_pending",
      requestedAt: z.string().parse(raw.requested_at),
      company: {
        country: pending.country,
        taxId: pending.tax_id,
        vatId: emptyToNull(pending.vat_id),
        name: pending.name,
        shortName: emptyToNull(pending.short_name),
        legalForm: emptyToNull(pending.legal_form),
        address: emptyToNull(pending.address),
        postalCode: emptyToNull(pending.postal_code),
        city: emptyToNull(pending.city),
        mailAddress: emptyToNull(pending.mail_address),
        mailPostalCode: emptyToNull(pending.mail_postal_code),
        mailCity: emptyToNull(pending.mail_city),
        phone: emptyToNull(pending.phone),
        email: emptyToNull(pending.email),
        website: emptyToNull(pending.website),
        activity: emptyToNull(pending.activity),
        bankAccounts: pending.bank_accounts.map((b) => ({
          bankName: b.bank_name,
          accountNumber: b.account_number,
          iban: b.iban,
          swift: b.swift,
          isPrimary: b.is_primary,
        })),
      },
    };
  }
  return { status: "none" };
}

/** Public directory data of one company (members only, via RPC). */
export async function getCompany(companyId: string): Promise<Company | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company", { p_company_id: companyId });
  if (error) throw error;
  return data === null ? null : companyJsonSchema.parse(data);
}

const changesSchema = z.record(z.string(), z.string().nullable());

export type ChangeRequestToDecide = {
  id: string;
  kind: "update" | "claim";
  company: Company;
  changes: Record<string, string | null>;
  bankAccountsChanged: boolean;
  reason: string | null;
  /** Only for the platform admin. */
  requestedBy: string | null;
  createdAt: string;
};

export async function listChangeRequestsToDecide(
  organizationId: string,
): Promise<ChangeRequestToDecide[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_change_requests_to_decide", {
    p_org_id: organizationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    kind: row.kind === "claim" ? "claim" : "update",
    company: companyJsonSchema.parse(row.company),
    changes: changesSchema.parse(row.changes),
    bankAccountsChanged: row.bank_accounts !== null,
    reason: row.reason,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  }));
}

export type MyChangeRequest = {
  id: string;
  kind: "update" | "claim";
  companyName: string;
  changes: Record<string, string | null>;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

const statusSchema = z.enum(["pending", "approved", "rejected", "withdrawn"]);

export async function listMyChangeRequests(organizationId: string): Promise<MyChangeRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_company_change_requests", {
    p_org_id: organizationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    kind: row.kind === "claim" ? "claim" : "update",
    companyName: row.company_name,
    changes: changesSchema.parse(row.changes),
    status: statusSchema.parse(row.status),
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }));
}
