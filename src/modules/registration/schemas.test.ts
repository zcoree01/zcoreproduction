import { describe, expect, it } from "vitest";
import { EMPTY_BANK_ACCOUNT } from "@/modules/companies/schemas";
import {
  draftOf,
  EMPTY_REGISTRATION,
  REGISTRATION_STEPS,
  registrationSchema,
  registrationSlugSchema,
  suggestSlug,
} from "./schemas";

const VALID = {
  ...EMPTY_REGISTRATION,
  name: "Metal Precision d.o.o. Sarajevo",
  taxId: "4200000000001",
  address: "Industrijska 5",
  city: "Sarajevo",
  bankAccounts: [{ ...EMPTY_BANK_ACCOUNT, bankName: "Banka", accountNumber: "1290079401028494" }],
  slug: "metal-precision",
  adminFullName: "Mirza Zebić",
  adminUsername: "mirza.z",
  adminPassword: "Sigurna-lozinka-1",
  adminConfirmPassword: "Sigurna-lozinka-1",
  acceptTerms: true,
};

describe("registrationSchema", () => {
  it("accepts a complete registration", () => {
    expect(registrationSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires the terms, matching passwords and a password other than the username", () => {
    const result = registrationSchema.safeParse({
      ...VALID,
      acceptTerms: false,
      adminPassword: "mirza.z1",
      adminConfirmPassword: "mirza.z2",
    });
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "acceptTerms",
      "adminConfirmPassword",
    ]);
    const same = registrationSchema.safeParse({
      ...VALID,
      adminPassword: "mirza.zz",
      adminConfirmPassword: "mirza.zz",
      adminUsername: "mirza.zz",
    });
    expect(same.error?.issues.map((issue) => issue.message)).toEqual(["username"]);
  });

  it("rejects a filled honeypot", () => {
    expect(registrationSchema.safeParse({ ...VALID, website2: "spam" }).success).toBe(false);
  });

  it("covers every form field in exactly one step", () => {
    const fields = REGISTRATION_STEPS.flatMap((step) => step.fields as readonly string[]);
    expect(new Set(fields).size).toBe(fields.length);
    for (const key of Object.keys(EMPTY_REGISTRATION)) {
      if (key !== "website2") expect(fields).toContain(key);
    }
  });
});

describe("subdomains", () => {
  it("refuses reserved, test and too short subdomains", () => {
    for (const slug of ["zcore", "www", "test-tenant-c", "ab", "Metal Firma"]) {
      expect(registrationSlugSchema.safeParse(slug).success, slug).toBe(false);
    }
    expect(registrationSlugSchema.parse("metal-precision")).toBe("metal-precision");
  });

  it("suggests a subdomain from the name without the legal form", () => {
    expect(suggestSlug("Metal Precision d.o.o. Sarajevo")).toBe("metal-precision-sarajevo");
    expect(suggestSlug("Čelik & Žica d.d.")).toBe("celik-zica");
  });
});

describe("draftOf", () => {
  it("never keeps the password in the draft", () => {
    const draft = draftOf(VALID);
    expect(draft).not.toHaveProperty("adminPassword");
    expect(draft).not.toHaveProperty("adminConfirmPassword");
    expect(draft.slug).toBe("metal-precision");
  });
});
