import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTenantLocked, setupFixture, type Fixture } from "./fixtures";

// The organization lock covers the shared company directory and Storage
// uploads (D-060). Tenant B is locked only inside the describe block.

const LOCKED = { code: "42501", message: "organization_locked" };
let fx: Fixture;
let ownCompanyOfA = "";
let customerInB = "";
const PDF = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });

beforeAll(async () => {
  fx = await setupFixture();
  const org = await fx.service
    .from("organizations")
    .select("company_id")
    .eq("id", fx.a.org.id)
    .single()
    .throwOnError();
  ownCompanyOfA = org.data.company_id ?? "";
  // B buys from A: a change to A's directory entry can only come from a firm
  // that has it as a customer.
  const existing = await fx.service
    .from("customers")
    .select("id")
    .eq("organization_id", fx.b.org.id)
    .eq("company_id", ownCompanyOfA)
    .is("archived_at", null)
    .maybeSingle()
    .throwOnError();
  customerInB =
    existing.data?.id ??
    (
      await fx.service
        .from("customers")
        .insert({ organization_id: fx.b.org.id, name: "DBL Kupac A", company_id: ownCompanyOfA })
        .select("id")
        .single()
        .throwOnError()
    ).data.id;
}, 60_000);

afterAll(async () => {
  await setTenantLocked(fx.service, fx.b.org.id, false);
});

describe("a locked organization", () => {
  beforeAll(() => setTenantLocked(fx.service, fx.b.org.id, true));
  afterAll(() => setTenantLocked(fx.service, fx.b.org.id, false));

  it("cannot propose a change to a directory entry", async () => {
    expect(ownCompanyOfA).not.toBe("");
    const proposal = await fx.b.admin.rpc("request_company_change", {
      p_org_id: fx.b.org.id,
      p_company_id: ownCompanyOfA,
      p_changes: { phone: "033 000 000" },
      p_reason: "DB lock test",
    });
    expect(proposal.error).toMatchObject(LOCKED);
  });

  it("cannot save its own company profile", async () => {
    const saved = await fx.b.admin.rpc("save_organization_profile", {
      p_org_id: fx.b.org.id,
      p_country: "BA",
      p_tax_id: "4999000000002",
      p_fields: { name: "Test Tenant B d.o.o.", address: "Glavna 2", city: "Mostar" },
      p_bank_accounts: [],
    });
    expect(saved.error).toMatchObject(LOCKED);
  });

  it("cannot upload files to its folders", async () => {
    const path = `${fx.b.org.id}/db-lock-test/${Date.now()}.pdf`;
    const upload = await fx.b.admin.storage.from("product-files").upload(path, PDF());
    expect(upload.error).not.toBeNull();
    const stored = await fx.service.storage
      .from("product-files")
      .list(`${fx.b.org.id}/db-lock-test`);
    expect(stored.data ?? []).toEqual([]);
  });

  it("does not stop an unlocked organization", async () => {
    const path = `${fx.a.org.id}/db-lock-test/${Date.now()}.pdf`;
    const upload = await fx.a.admin.storage.from("product-files").upload(path, PDF());
    expect(upload.error).toBeNull();
    await fx.service.storage.from("product-files").remove([path]);
  });
});

describe("directory changes of an unlocked firm", () => {
  it("still reach the customers of a locked firm", async () => {
    // A edits its own entry; the sync onto B's customer row must not be
    // stopped by B's lock (it is A's change, not B's).
    await setTenantLocked(fx.service, fx.b.org.id, true);
    try {
      const phone = `033 ${Date.now() % 1_000_000}`;
      const saved = await fx.a.admin.rpc("save_organization_profile", {
        p_org_id: fx.a.org.id,
        p_country: "BA",
        p_tax_id: (
          await fx.service.from("companies").select("tax_id").eq("id", ownCompanyOfA).single()
        ).data!.tax_id,
        p_fields: { phone },
        p_bank_accounts: [
          { bank_name: "Banka", account_number: "1290079401028494", is_primary: true },
        ],
      });
      expect(saved.error).toBeNull();
      expect(customerInB).not.toBe("");
    } finally {
      await setTenantLocked(fx.service, fx.b.org.id, false);
    }
  });
});

describe("after unlocking", () => {
  it("uploads work again", async () => {
    const path = `${fx.b.org.id}/db-lock-test/${Date.now()}.pdf`;
    const upload = await fx.b.admin.storage.from("product-files").upload(path, PDF());
    expect(upload.error).toBeNull();
    await fx.service.storage.from("product-files").remove([path]);
  });
});
