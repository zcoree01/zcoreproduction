import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toAuthEmail } from "@/lib/auth/username";
import type { Database } from "@/lib/supabase/types";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { TEST_TENANTS, testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Shared company directory, platform admin, support access and registration
// (D-026). Directory rows are never deleted: every run uses fresh tax ids
// ("DBT" names). The platform admin test user is deactivated after the run.

const RUN = Date.now().toString().slice(-8);
const PLATFORM_USER = "db.platform";
const SUPPORT_USER = "zcore-podrska";

let f: Fixture;
let platform: SupabaseClient<Database>;
let platformOrgId = "";
let platformUserId = "";
const registeredOrgs: string[] = [];

/** 13-digit Bosnian ID number, unique per run and suffix. */
const jib = (suffix: string) => `4${RUN}${suffix.padStart(4, "0")}`.slice(0, 13);

function customer(name: string, extra: Record<string, string> = {}) {
  return {
    customer_number: "",
    name,
    tax_id: "",
    address: "",
    postal_code: "",
    city: "",
    country: "BA",
    contact_person: "",
    phone: "",
    email: "",
    notes: "",
    ...extra,
  };
}

async function saveCustomer(
  client: SupabaseClient<Database>,
  orgId: string,
  data: Record<string, string>,
  companyId?: string,
) {
  const { data: result, error } = await client.rpc("save_customer", {
    p_org_id: orgId,
    p_customer: data,
    p_company_id: companyId,
  });
  if (error) throw error;
  return result as {
    id: string;
    company_id: string | null;
    directory: string;
    change_requested: boolean;
  };
}

beforeAll(async () => {
  f = await setupFixture();
  const zcore = await ensureOrganization(f.service, { slug: "zcore", name: "Zcore" });
  platformOrgId = zcore.id;
  platformUserId = await ensureUser(f.service, zcore, {
    username: PLATFORM_USER,
    password: testTenantPassword(),
    fullName: "DB Platform",
    role: "admin",
  });
  const reactivated = await f.service
    .from("memberships")
    .update({ archived_at: null })
    .eq("user_id", platformUserId);
  if (reactivated.error) throw reactivated.error;
  platform = await signIn(PLATFORM_USER, "zcore");

  // A previous run may have left support access open.
  const open = await f.service
    .from("support_access_requests")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("organization_id", f.a.org.id)
    .in("status", ["pending", "approved", "active"]);
  if (open.error) throw open.error;
});

afterAll(async () => {
  // No usable platform admin with the test password outside test runs.
  await f.service
    .from("memberships")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", platformUserId);
  if (registeredOrgs.length > 0) {
    await f.service
      .from("organizations")
      .update({ archived_at: new Date().toISOString() })
      .in("id", registeredOrgs);
  }
});

describe("company directory", () => {
  it("is not readable as a table, only through the RPCs", async () => {
    const { error } = await f.a.admin.from("companies").select("id").limit(1);
    expect(error?.code).toBe("42501");
    const anon = await f.anon.rpc("search_companies", { p_query: "DBT" });
    expect(anon.error).not.toBeNull();
  });

  it("creates an entry when a customer is saved and offers it to others only after 3 characters", async () => {
    const name = `DBT Imenik ${RUN}`;
    const saved = await saveCustomer(
      f.a.admin,
      f.a.org.id,
      customer(name, { tax_id: jib("1"), city: "Zenica" }),
    );
    expect(saved.directory).toBe("created");

    const short = await f.b.admin.rpc("search_companies", { p_query: "DB" });
    expect(short.data).toEqual([]);
    const found = await f.b.admin.rpc("search_companies", { p_query: `imenik ${RUN}` });
    expect(found.data?.map((c) => c.name)).toEqual([name]);
    const byTax = await f.b.admin.rpc("search_companies", { p_query: jib("1") });
    expect(byTax.data?.[0]?.id).toBe(saved.company_id);

    // Who added it is never revealed.
    const company = await f.b.admin.rpc("get_company", { p_company_id: saved.company_id ?? "" });
    expect(JSON.stringify(company.data)).not.toContain(f.a.org.id);
    expect(company.data).toMatchObject({ name, city: "Zenica", registered: false });
  });

  it("links a second organization to the same entry and turns different data into a proposal", async () => {
    const tax = jib("2");
    const first = await saveCustomer(
      f.a.admin,
      f.a.org.id,
      customer(`DBT Kupac ${RUN}`, { tax_id: tax, address: "Stara 1" }),
    );
    const second = await saveCustomer(
      f.b.admin,
      f.b.org.id,
      customer(`DBT Kupac ${RUN}`, { tax_id: tax, address: "Nova 2", contact_person: "Privatno" }),
    );
    expect(second).toMatchObject({
      company_id: first.company_id,
      directory: "linked",
      change_requested: true,
    });

    // B's customer shows the directory address; the contact person stays private.
    const row = await f.b.admin
      .from("customers")
      .select("address, contact_person")
      .eq("id", second.id)
      .single();
    expect(row.data).toEqual({ address: "Stara 1", contact_person: "Privatno" });
    const company = await f.a.admin.rpc("get_company", { p_company_id: first.company_id ?? "" });
    expect(JSON.stringify(company.data)).not.toContain("Privatno");

    // Entry without owner: the Zcore platform admin decides; approving updates A's customer too.
    const toDecide = await platform.rpc("company_change_requests_to_decide", {
      p_org_id: platformOrgId,
    });
    const request = toDecide.data?.find(
      (r) => (r.company as { id: string }).id === first.company_id,
    );
    expect(request?.requested_by).toBe(TEST_TENANTS.b.name);
    const ownerDenied = await f.a.admin.rpc("decide_company_change", {
      p_org_id: f.a.org.id,
      p_request_id: request?.id ?? "",
      p_approve: true,
      p_note: "",
    });
    expect(ownerDenied.error?.code).toBe("42501");
    const approved = await platform.rpc("decide_company_change", {
      p_org_id: platformOrgId,
      p_request_id: request?.id ?? "",
      p_approve: true,
      p_note: "",
    });
    expect(approved.error).toBeNull();
    const synced = await f.a.admin.from("customers").select("address").eq("id", first.id).single();
    expect(synced.data?.address).toBe("Nova 2");
  });

  it("lets the owner decide proposals for its own entry without seeing who sent them", async () => {
    const tax = jib("3");
    const profile = await f.a.admin.rpc("save_organization_profile", {
      p_org_id: f.a.org.id,
      p_country: "BA",
      p_tax_id: tax,
      // The short name is the organization's display name: keep the tenant's.
      p_fields: {
        name: `DBT Vlasnik ${RUN}`,
        short_name: TEST_TENANTS.a.name,
        address: "Glavna 1",
        city: "Sarajevo",
      },
      p_bank_accounts: [
        { bank_name: "Banka", account_number: "1290079401028494", is_primary: true },
      ],
    });
    expect(profile.data).toBe("owned");
    const operatorDenied = await f.a.operator.rpc("save_organization_profile", {
      p_org_id: f.a.org.id,
      p_country: "BA",
      p_tax_id: tax,
      p_fields: { name: "X" },
      p_bank_accounts: [],
    });
    expect(operatorDenied.error?.code).toBe("42501");

    const linked = await saveCustomer(f.b.admin, f.b.org.id, customer("ignored", { tax_id: tax }));
    const proposal = await f.b.admin.rpc("request_company_change", {
      p_org_id: f.b.org.id,
      p_company_id: linked.company_id ?? "",
      p_changes: { phone: "033 123 456" },
      p_reason: "Novi telefon",
    });
    expect(proposal.error).toBeNull();

    const incoming = await f.a.admin.rpc("company_change_requests_to_decide", {
      p_org_id: f.a.org.id,
    });
    const request = incoming.data?.find((r) => r.id === proposal.data);
    expect(request?.requested_by).toBeNull();
    const decided = await f.a.admin.rpc("decide_company_change", {
      p_org_id: f.a.org.id,
      p_request_id: proposal.data ?? "",
      p_approve: true,
      p_note: "",
    });
    expect(decided.error).toBeNull();
    const synced = await f.b.admin
      .from("customers")
      .select("phone, name")
      .eq("id", linked.id)
      .single();
    expect(synced.data).toEqual({ phone: "033 123 456", name: `DBT Vlasnik ${RUN}` });
  });
});

describe("platform administration", () => {
  it("is refused to organization admins", async () => {
    const { error } = await f.a.admin.rpc("platform_organizations");
    expect(error?.code).toBe("42501");
    const setModule = await f.a.admin.rpc("platform_set_module", {
      p_org_id: f.a.org.id,
      p_module: "production",
      p_enabled: true,
    });
    expect(setModule.error?.code).toBe("42501");
  });

  it("lists organizations with their modules and never the platform organization", async () => {
    const { data, error } = await platform.rpc("platform_organizations");
    expect(error).toBeNull();
    const tenant = data?.find((o) => o.slug === TEST_TENANTS.a.slug);
    expect(tenant?.modules).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "production", enabled: true })]),
    );
    expect(data?.some((o) => o.slug === "zcore")).toBe(false);
  });
});

describe("registration", () => {
  it("is only possible with the service role", async () => {
    const args = {
      p_slug: `dbt-${RUN}`,
      p_timezone: "Europe/Sarajevo",
      p_country: "BA",
      p_tax_id: jib("4"),
      p_fields: { name: "X" },
      p_bank_accounts: [],
    };
    expect((await f.a.admin.rpc("register_organization", args)).error?.code).toBe("42501");
    expect((await f.anon.rpc("register_organization", args)).error).not.toBeNull();
  });

  it("starts every module as a trial and turns an existing entry into a claim for Zcore", async () => {
    const tax = jib("5");
    const existing = await saveCustomer(
      f.a.admin,
      f.a.org.id,
      customer(`DBT Preuzimanje ${RUN}`, { tax_id: tax }),
    );
    const { data, error } = await f.service.rpc("register_organization", {
      p_slug: `dbt-reg-${RUN}`,
      p_timezone: "Europe/Sarajevo",
      p_country: "BA",
      p_tax_id: tax,
      p_fields: { name: `DBT Registrovana ${RUN}`, address: "Nova 9", city: "Tuzla" },
      p_bank_accounts: [],
    });
    expect(error).toBeNull();
    const registered = data as { organization_id: string; claim: boolean; trial_days: number };
    registeredOrgs.push(registered.organization_id);
    expect(registered.claim).toBe(true);

    const modules = await f.service
      .from("org_modules")
      .select("module_key, active_until")
      .eq("organization_id", registered.organization_id);
    const trial = modules.data?.find((m) => m.module_key === "production");
    const days = (new Date(trial?.active_until ?? 0).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(registered.trial_days);

    // Zcore confirms the claim: the entry gets the new owner and its data.
    const claims = await platform.rpc("company_change_requests_to_decide", {
      p_org_id: platformOrgId,
    });
    const claim = claims.data?.find(
      (r) => r.kind === "claim" && (r.company as { id: string }).id === existing.company_id,
    );
    expect(claim).toBeDefined();
    await platform.rpc("decide_company_change", {
      p_org_id: platformOrgId,
      p_request_id: claim?.id ?? "",
      p_approve: true,
      p_note: "",
    });
    const company = await f.a.admin.rpc("get_company", { p_company_id: existing.company_id ?? "" });
    expect(company.data).toMatchObject({
      name: `DBT Registrovana ${RUN}`,
      city: "Tuzla",
      registered: true,
    });
  });
});

describe("support access", () => {
  it("works only between approval and end, for the organization that approved it", async () => {
    const asked = await platform.rpc("platform_request_support", {
      p_org_id: f.a.org.id,
      p_reason: "DBT provjera",
    });
    expect(asked.error).toBeNull();
    const requestId = asked.data ?? "";

    const operatorDenied = await f.a.operator.rpc("decide_support_request", {
      p_org_id: f.a.org.id,
      p_request_id: requestId,
      p_approve: true,
      p_minutes: 30,
    });
    expect(operatorDenied.error?.code).toBe("42501");

    // The organization's support account (created by the server when entering).
    const existing = await f.service
      .from("profiles")
      .select("id")
      .eq("organization_id", f.a.org.id)
      .eq("username", SUPPORT_USER)
      .maybeSingle();
    let supportId = existing.data?.id ?? "";
    if (!supportId) {
      const created = await f.service.auth.admin.createUser({
        email: toAuthEmail(SUPPORT_USER, f.a.org.slug),
        password: testTenantPassword(),
        email_confirm: true,
        app_metadata: {
          organization_id: f.a.org.id,
          username: SUPPORT_USER,
          role: "admin",
          is_support: true,
        },
      });
      if (created.error) throw created.error;
      supportId = created.data.user.id;
    } else {
      await f.service.auth.admin.updateUserById(supportId, { password: testTenantPassword() });
    }
    await f.service.from("memberships").update({ archived_at: null }).eq("user_id", supportId);
    const support = await signIn(SUPPORT_USER, f.a.org.slug);

    // Not approved yet: no access at all.
    expect((await support.from("machines").select("id").limit(1)).data).toEqual([]);
    expect((await support.rpc("session_status").single()).data?.active).toBe(false);

    await f.a.admin.rpc("decide_support_request", {
      p_org_id: f.a.org.id,
      p_request_id: requestId,
      p_approve: true,
      p_minutes: 30,
    });
    const begun = await platform
      .rpc("platform_begin_support", { p_request_id: requestId })
      .single();
    expect(begun.data?.slug).toBe(f.a.org.slug);
    expect((await support.rpc("session_status").single()).data?.active).toBe(true);
    const members = await support
      .from("memberships")
      .select("id")
      .eq("organization_id", f.a.org.id);
    expect(members.data?.length).toBeGreaterThan(0);

    // The organization ends it: access is gone immediately.
    const ended = await f.a.admin.rpc("end_support", { p_request_id: requestId });
    expect(ended.error).toBeNull();
    expect(
      (await support.from("memberships").select("id").eq("organization_id", f.a.org.id)).data,
    ).toEqual([]);
    expect((await support.rpc("session_status").single()).data?.active).toBe(false);
    await f.service
      .from("memberships")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", supportId);
  });

  it("cannot be requested by an organization admin", async () => {
    const { error } = await f.a.admin.rpc("platform_request_support", {
      p_org_id: f.b.org.id,
      p_reason: "x",
    });
    expect(error?.code).toBe("42501");
  });
});
