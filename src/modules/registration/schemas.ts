import { z } from "zod";
import { orgSlugSchema, usernameSchema } from "@/lib/auth/username";
import {
  bankAccountSchema,
  checkBankAccounts,
  checkTaxNumbers,
  companyBasicsShape,
  companyContactShape,
  EMPTY_COMPANY_PROFILE,
  type CompanyProfileFormValues,
} from "@/modules/companies/schemas";
import { newPasswordSchema } from "@/modules/profile/schemas";
import { normalizeNamePart } from "@/modules/users/username-suggest";

// Self-registration of a company in six steps (D-026). Shared by the wizard
// (per-step validation) and the server action (everything at once).

/** Subdomains that are never given to an organization. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "static",
  "zcore",
  "mail",
  "help",
  "podrska",
  "support",
  "status",
  "docs",
  "blog",
  "registracija",
]);

export const registrationSlugSchema = orgSlugSchema
  .refine((slug) => slug.length >= 3, { message: "slug_short" })
  .refine((slug) => !RESERVED_SLUGS.has(slug) && !slug.startsWith("test-"), {
    message: "slug_reserved",
  });

export const TIMEZONES = [
  "Europe/Sarajevo",
  "Europe/Zagreb",
  "Europe/Belgrade",
  "Europe/Podgorica",
  "Europe/Ljubljana",
  "Europe/Skopje",
  "Europe/Vienna",
  "Europe/Berlin",
  "Europe/London",
] as const;

const registrationShape = {
  ...companyBasicsShape,
  ...companyContactShape,
  bankAccounts: z.array(bankAccountSchema).max(10),
  slug: registrationSlugSchema,
  timezone: z.enum(TIMEZONES),
  adminFullName: z.string().trim().min(1).max(200),
  adminUsername: usernameSchema,
  adminPassword: newPasswordSchema,
  adminConfirmPassword: z.string().max(72),
  acceptTerms: z.boolean().refine((value) => value, { message: "terms" }),
  /** Honeypot: people never see or fill this field. */
  website2: z.string().max(0).optional(),
};

export const registrationSchema = z
  .object(registrationShape)
  .superRefine(checkTaxNumbers)
  .superRefine(checkBankAccounts)
  .refine((value) => value.adminPassword.trim().toLowerCase() !== value.adminUsername, {
    path: ["adminPassword"],
    message: "username",
  })
  .refine((value) => value.adminConfirmPassword === value.adminPassword, {
    path: ["adminConfirmPassword"],
    message: "mismatch",
  });

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type RegistrationFormValues = z.input<typeof registrationSchema>;

export const REGISTRATION_STEPS = [
  {
    key: "basics",
    fields: ["name", "shortName", "legalForm", "country", "taxId", "vatId", "activity"],
  },
  {
    key: "contact",
    fields: [
      "address",
      "postalCode",
      "city",
      "mailAddress",
      "mailPostalCode",
      "mailCity",
      "phone",
      "email",
      "website",
    ],
  },
  { key: "banking", fields: ["bankAccounts"] },
  { key: "system", fields: ["slug", "timezone"] },
  {
    key: "admin",
    fields: ["adminFullName", "adminUsername", "adminPassword", "adminConfirmPassword"],
  },
  { key: "review", fields: ["acceptTerms"] },
] as const satisfies readonly { key: string; fields: readonly (keyof RegistrationFormValues)[] }[];

export type RegistrationStepKey = (typeof REGISTRATION_STEPS)[number]["key"];

export const EMPTY_REGISTRATION: RegistrationFormValues = {
  ...(EMPTY_COMPANY_PROFILE as CompanyProfileFormValues),
  slug: "",
  timezone: "Europe/Sarajevo",
  adminFullName: "",
  adminUsername: "",
  adminPassword: "",
  adminConfirmPassword: "",
  acceptTerms: false,
  website2: "",
};

/** Subdomain suggestion from the company name ("Metal Precision d.o.o." → "metal-precision"). */
export function suggestSlug(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/\b(d\.?\s?o\.?\s?o|d\.?\s?d|j\.?\s?d\.?\s?o\.?\s?o|s\.?\s?p|obrt)\b\.?/g, " ")
    .split(/[\s,./-]+/)
    .map(normalizeNamePart)
    .filter(Boolean);
  return words.join("-").slice(0, 40).replace(/-+$/, "");
}

/** Values kept between steps in the browser (never the password). */
export function draftOf(values: RegistrationFormValues): Partial<RegistrationFormValues> {
  const { adminPassword: _password, adminConfirmPassword: _confirm, ...rest } = values;
  void _password;
  void _confirm;
  return rest;
}
