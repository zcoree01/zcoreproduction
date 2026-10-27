import { describe, expect, it } from "vitest";
import {
  baAccountToIban,
  companyProfileSchema,
  EMPTY_BANK_ACCOUNT,
  EMPTY_COMPANY_PROFILE,
  isValidBaAccount,
  isValidIban,
  normalizeTaxId,
  toBankAccountsJson,
  toCompanyFieldsJson,
} from "./schemas";

// Example account from the IBAN registry (BA39 1290 0794 0102 8494).
const BA_ACCOUNT = "1290079401028494";

const VALID = {
  ...EMPTY_COMPANY_PROFILE,
  name: "Metal Precision d.o.o.",
  taxId: "4200000000001",
  vatId: "200000000001",
  address: "Industrijska 5",
  city: "Sarajevo",
  bankAccounts: [{ ...EMPTY_BANK_ACCOUNT, bankName: "Banka", accountNumber: BA_ACCOUNT }],
};

describe("tax numbers and bank accounts", () => {
  it("normalizes tax ids", () => {
    expect(normalizeTaxId(" 4200-000 000.001 ")).toBe("4200000000001");
    expect(normalizeTaxId("de 123/456")).toBe("DE123456");
  });

  it("checks IBANs with mod 97", () => {
    expect(isValidIban("BA39 1290 0794 0102 8494")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("BA39 1290 0794 0102 8495")).toBe(false);
    expect(isValidIban("not an iban")).toBe(false);
  });

  it("checks Bosnian account numbers through their IBAN", () => {
    expect(isValidBaAccount("129-0079401028494")).toBe(true);
    expect(isValidBaAccount("1290079401028493")).toBe(false);
    expect(isValidBaAccount("12900794")).toBe(false);
    expect(baAccountToIban(BA_ACCOUNT)).toBe("BA391290079401028494");
  });
});

describe("companyProfileSchema", () => {
  it("accepts a Bosnian company with JIB, VAT number and account", () => {
    const parsed = companyProfileSchema.parse(VALID);
    expect(parsed.taxId).toBe("4200000000001");
    expect(parsed.bankAccounts[0]?.accountNumber).toBe(BA_ACCOUNT);
  });

  it("requires 13 digits for a Bosnian ID number and 12 for the VAT number", () => {
    const result = companyProfileSchema.safeParse({
      ...VALID,
      taxId: "12345",
      vatId: "4200000000001",
    });
    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["taxId", "ba_tax_id"],
      ["vatId", "ba_vat_id"],
    ]);
  });

  it("does not apply Bosnian rules to foreign companies", () => {
    const parsed = companyProfileSchema.parse({
      ...VALID,
      country: "DE",
      taxId: "de 123456789",
      vatId: "",
      bankAccounts: [{ ...EMPTY_BANK_ACCOUNT, bankName: "Bank", iban: "DE89370400440532013000" }],
    });
    expect(parsed.taxId).toBe("DE123456789");
  });

  it("rejects a wrong Bosnian account number and a bank account without number or IBAN", () => {
    const wrong = companyProfileSchema.safeParse({
      ...VALID,
      bankAccounts: [
        { ...EMPTY_BANK_ACCOUNT, bankName: "Banka", accountNumber: "1290079401028493" },
        { ...EMPTY_BANK_ACCOUNT, bankName: "Druga" },
      ],
    });
    expect(wrong.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "bankAccounts.1.accountNumber",
      "bankAccounts.0.accountNumber",
    ]);
  });

  it("requires name, address and city", () => {
    const result = companyProfileSchema.safeParse({ ...VALID, name: " ", address: "", city: "" });
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "address",
      "city",
      "name",
    ]);
  });
});

describe("RPC payloads", () => {
  it("uses the directory field names and marks exactly one primary account", () => {
    const parsed = companyProfileSchema.parse({
      ...VALID,
      bankAccounts: [
        { ...EMPTY_BANK_ACCOUNT, bankName: "A", iban: "BA391290079401028494" },
        { ...EMPTY_BANK_ACCOUNT, bankName: "B", accountNumber: BA_ACCOUNT },
      ],
    });
    expect(toCompanyFieldsJson(parsed)).toMatchObject({
      name: "Metal Precision d.o.o.",
      short_name: "",
      vat_id: "200000000001",
    });
    expect(toBankAccountsJson(parsed.bankAccounts).map((b) => b.is_primary)).toEqual([true, false]);
  });
});
