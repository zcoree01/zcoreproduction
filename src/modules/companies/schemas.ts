import { z } from "zod";
import { COUNTRY_CODES } from "@/lib/countries";
import { optionalText, requiredText } from "@/lib/forms";

// Company data shared by the organization profile (settings and registration),
// the directory and change requests. Limits mirror the CHECKs on
// public.companies / public.company_bank_accounts.

/** Tax / VAT numbers and IBANs: no spaces, dots, dashes or slashes, upper case. */
export function normalizeTaxId(value: string): string {
  return value.replace(/[\s./-]/g, "").toUpperCase();
}

/** ISO 13616 check (mod 97 = 1), computed piecewise so no big integers are needed. */
export function isValidIban(value: string): boolean {
  const iban = normalizeTaxId(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * Bosnian bank account (žiro račun): 16 digits whose last two are a mod-97
 * check. The Bosnian IBAN is always "BA39" + the account number, so the IBAN
 * check validates the account number as well.
 */
export function isValidBaAccount(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{16}$/.test(digits) && isValidIban(`BA39${digits}`);
}

/** IBAN of a Bosnian account number. */
export function baAccountToIban(value: string): string {
  return `BA39${value.replace(/[\s-]/g, "")}`;
}

const countrySchema = z.enum(COUNTRY_CODES);

const optionalTaxNumber = z
  .string()
  .trim()
  .max(50)
  .transform((value) => (value === "" ? null : normalizeTaxId(value)));

export const bankAccountSchema = z
  .object({
    bankName: requiredText(200),
    accountNumber: z
      .string()
      .trim()
      .max(50)
      .transform((value) => (value === "" ? null : value.replace(/[\s-]/g, ""))),
    iban: optionalTaxNumber.refine((value) => value === null || isValidIban(value), {
      message: "iban",
    }),
    swift: optionalTaxNumber.refine(
      (value) => value === null || /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(value),
      { message: "swift" },
    ),
    isPrimary: z.boolean(),
  })
  .refine((account) => account.accountNumber !== null || account.iban !== null, {
    path: ["accountNumber"],
    message: "required",
  });

export type BankAccountInput = z.infer<typeof bankAccountSchema>;
export type BankAccountFormValues = z.input<typeof bankAccountSchema>;

// Step "Osnovne informacije".
export const companyBasicsShape = {
  name: requiredText(200),
  shortName: optionalText(100),
  legalForm: optionalText(50),
  country: countrySchema,
  taxId: z.string().trim().min(1).max(50).transform(normalizeTaxId),
  vatId: optionalTaxNumber,
  activity: optionalText(200),
};

// Step "Adresa i kontakt".
export const companyContactShape = {
  address: requiredText(300),
  postalCode: optionalText(20),
  city: requiredText(100),
  mailAddress: optionalText(300),
  mailPostalCode: optionalText(20),
  mailCity: optionalText(100),
  phone: optionalText(50),
  email: optionalText(200).refine(
    (value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
    { message: "email" },
  ),
  website: optionalText(200),
};

type TaxFields = { country: string; taxId: string; vatId: string | null };

/** Bosnia and Herzegovina: ID number (JIB) 13 digits, VAT number 12 digits. */
export function checkTaxNumbers(value: TaxFields, ctx: z.RefinementCtx) {
  if (value.country !== "BA") return;
  if (!/^\d{13}$/.test(value.taxId)) {
    ctx.addIssue({ code: "custom", path: ["taxId"], message: "ba_tax_id" });
  }
  if (value.vatId !== null && !/^\d{12}$/.test(value.vatId)) {
    ctx.addIssue({ code: "custom", path: ["vatId"], message: "ba_vat_id" });
  }
}

type BankFields = { country: string; bankAccounts: BankAccountInput[] };

export function checkBankAccounts(value: BankFields, ctx: z.RefinementCtx) {
  value.bankAccounts.forEach((account, index) => {
    if (
      value.country === "BA" &&
      account.accountNumber &&
      !isValidBaAccount(account.accountNumber)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["bankAccounts", index, "accountNumber"],
        message: "ba_account",
      });
    }
  });
}

export const companyBasicsSchema = z.object(companyBasicsShape).superRefine(checkTaxNumbers);
export const companyContactSchema = z.object(companyContactShape);
export const companyBankingSchema = z
  .object({
    country: countrySchema,
    bankAccounts: z.array(bankAccountSchema).max(10),
  })
  .superRefine(checkBankAccounts);

export const companyProfileSchema = z
  .object({
    ...companyBasicsShape,
    ...companyContactShape,
    bankAccounts: z.array(bankAccountSchema).max(10),
  })
  .superRefine(checkTaxNumbers)
  .superRefine(checkBankAccounts);

export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
export type CompanyProfileFormValues = z.input<typeof companyProfileSchema>;

export const EMPTY_BANK_ACCOUNT: BankAccountFormValues = {
  bankName: "",
  accountNumber: "",
  iban: "",
  swift: "",
  isPrimary: false,
};

export const EMPTY_COMPANY_PROFILE: CompanyProfileFormValues = {
  name: "",
  shortName: "",
  legalForm: "",
  country: "BA",
  taxId: "",
  vatId: "",
  activity: "",
  address: "",
  postalCode: "",
  city: "",
  mailAddress: "",
  mailPostalCode: "",
  mailCity: "",
  phone: "",
  email: "",
  website: "",
  bankAccounts: [],
};

/** Field keys of private.company_fields() (snake_case JSON for the RPCs). */
export const COMPANY_FIELD_KEYS = {
  name: "name",
  shortName: "short_name",
  legalForm: "legal_form",
  vatId: "vat_id",
  address: "address",
  postalCode: "postal_code",
  city: "city",
  mailAddress: "mail_address",
  mailPostalCode: "mail_postal_code",
  mailCity: "mail_city",
  phone: "phone",
  email: "email",
  website: "website",
  activity: "activity",
} as const;

export type CompanyFieldKey = keyof typeof COMPANY_FIELD_KEYS;
export const COMPANY_FIELDS = Object.keys(COMPANY_FIELD_KEYS) as CompanyFieldKey[];

export function toCompanyFieldsJson(input: Pick<CompanyProfileInput, CompanyFieldKey>) {
  return Object.fromEntries(
    COMPANY_FIELDS.map((field) => [COMPANY_FIELD_KEYS[field], input[field] ?? ""]),
  ) as Record<(typeof COMPANY_FIELD_KEYS)[CompanyFieldKey], string>;
}

/** Bank accounts for the RPCs; exactly one primary (the first one when none is marked). */
export function toBankAccountsJson(accounts: BankAccountInput[]) {
  const primary = Math.max(
    0,
    accounts.findIndex((account) => account.isPrimary),
  );
  return accounts.map((account, index) => ({
    bank_name: account.bankName,
    account_number: account.accountNumber,
    iban: account.iban,
    swift: account.swift,
    is_primary: index === primary,
  }));
}

// ---------------------------------------------------------------------------
// Directory data read back from the RPCs (private.company_json)
// ---------------------------------------------------------------------------
const nullableText = z.string().nullable();

export const companyRawSchema = z.object({
  id: z.uuid(),
  country: z.string(),
  tax_id: z.string(),
  vat_id: nullableText,
  name: z.string(),
  short_name: nullableText,
  legal_form: nullableText,
  address: nullableText,
  postal_code: nullableText,
  city: nullableText,
  mail_address: nullableText,
  mail_postal_code: nullableText,
  mail_city: nullableText,
  phone: nullableText,
  email: nullableText,
  website: nullableText,
  activity: nullableText,
  registered: z.boolean(),
  bank_accounts: z.array(
    z.object({
      bank_name: z.string(),
      account_number: nullableText,
      iban: nullableText,
      swift: nullableText,
      is_primary: z.boolean(),
    }),
  ),
});

export const companyJsonSchema = companyRawSchema.transform((c) => ({
  id: c.id,
  country: c.country,
  taxId: c.tax_id,
  vatId: c.vat_id,
  name: c.name,
  shortName: c.short_name,
  legalForm: c.legal_form,
  address: c.address,
  postalCode: c.postal_code,
  city: c.city,
  mailAddress: c.mail_address,
  mailPostalCode: c.mail_postal_code,
  mailCity: c.mail_city,
  phone: c.phone,
  email: c.email,
  website: c.website,
  activity: c.activity,
  registered: c.registered,
  bankAccounts: c.bank_accounts.map((b) => ({
    bankName: b.bank_name,
    accountNumber: b.account_number,
    iban: b.iban,
    swift: b.swift,
    isPrimary: b.is_primary,
  })),
}));

export type Company = z.infer<typeof companyJsonSchema>;

/** Company data as form values (null → ""). */
export function companyToFormValues(
  company: Omit<Company, "id" | "registered">,
): CompanyProfileFormValues {
  const text = (value: string | null) => value ?? "";
  return {
    name: company.name,
    shortName: text(company.shortName),
    legalForm: text(company.legalForm),
    country: (COUNTRY_CODES as readonly string[]).includes(company.country)
      ? (company.country as CompanyProfileFormValues["country"])
      : "BA",
    taxId: company.taxId,
    vatId: text(company.vatId),
    activity: text(company.activity),
    address: text(company.address),
    postalCode: text(company.postalCode),
    city: text(company.city),
    mailAddress: text(company.mailAddress),
    mailPostalCode: text(company.mailPostalCode),
    mailCity: text(company.mailCity),
    phone: text(company.phone),
    email: text(company.email),
    website: text(company.website),
    bankAccounts: company.bankAccounts.map((b) => ({
      bankName: b.bankName,
      accountNumber: text(b.accountNumber),
      iban: text(b.iban),
      swift: text(b.swift),
      isPrimary: b.isPrimary,
    })),
  };
}

// ---------------------------------------------------------------------------
// Change requests
// ---------------------------------------------------------------------------
export const changeRequestSchema = z
  .object({
    companyId: z.uuid(),
    changes: z.partialRecord(
      z.enum(COMPANY_FIELDS as [CompanyFieldKey, ...CompanyFieldKey[]]),
      z.string().trim().max(300),
    ),
    reason: z.string().trim().max(1000),
  })
  .refine((value) => Object.keys(value.changes).length > 0, { path: ["changes"] });

export type ChangeRequestInput = z.infer<typeof changeRequestSchema>;

export const decisionSchema = z
  .object({ requestId: z.uuid(), approve: z.boolean(), note: z.string().trim().max(1000) })
  .refine((value) => value.approve || value.note.length > 0, { path: ["note"] });
