import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalText, optionalUuid, requiredText } from "@/lib/forms";

// Shared by the client form (react-hook-form) and the server action.
// Limits mirror the CHECKs on public.customers. With a tax id and a country
// (ISO code) the customer is linked to the shared company directory (D-026).
export const customerSchema = z
  .object({
    /** "" = next number automatically. */
    customerNumber: z
      .string()
      .trim()
      .regex(/^\d{0,6}$/)
      .transform((value) => (value === "" ? null : Number(value)))
      .refine((value) => value === null || value >= 1, "number from 1"),
    name: requiredText(200),
    taxId: optionalText(50),
    address: optionalText(300),
    postalCode: optionalText(20),
    city: optionalText(100),
    /** ISO code; older customers may still hold a free-text country. */
    country: optionalText(100),
    contactPerson: optionalText(200),
    phone: optionalText(50),
    email: optionalText(200).refine(
      (value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
      "invalid e-mail",
    ),
    notes: optionalText(2000),
    /** Picked from the directory suggestions; "" = none. */
    companyId: optionalUuid,
  })
  // Bosnia and Herzegovina: ID number (13 digits) or VAT number (12 digits).
  .refine(
    (value) =>
      value.country !== "BA" ||
      value.taxId === null ||
      /^\d{12,13}$/.test(value.taxId.replace(/[\s./-]/g, "")),
    { path: ["taxId"], message: "ba_tax_id" },
  );

export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomerFormValues = z.input<typeof customerSchema>;

export const CUSTOMER_FIELDS = [
  "customerNumber",
  "name",
  "taxId",
  "address",
  "postalCode",
  "city",
  "country",
  "contactPerson",
  "phone",
  "email",
  "notes",
  "companyId",
] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];
export type CustomerError = "name_taken" | "number_taken" | "number_of_archived";
export type CustomerActionResult = ActionResult<CustomerField, CustomerError>;

/** Saving also reports what happened with the shared directory. */
export type CustomerSaveResult =
  | Extract<CustomerActionResult, { ok: false }>
  | {
      ok: true;
      id: string;
      directory: "linked" | "created" | "none";
      /** Typed data differed from the directory: sent as a change proposal. */
      changeRequested: boolean;
    };

/** Customer JSON for public.save_customer. */
export function toCustomerJson(input: CustomerInput) {
  return {
    customer_number: input.customerNumber === null ? "" : String(input.customerNumber),
    name: input.name,
    tax_id: input.taxId ?? "",
    address: input.address ?? "",
    postal_code: input.postalCode ?? "",
    city: input.city ?? "",
    country: input.country ?? "",
    contact_person: input.contactPerson ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    notes: input.notes ?? "",
  };
}
