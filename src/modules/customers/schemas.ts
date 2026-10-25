import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalText, requiredText } from "@/lib/forms";

// Shared by the client form (react-hook-form) and the server action.
// Limits mirror the CHECKs on public.customers.
export const customerSchema = z.object({
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
  city: optionalText(100),
  country: optionalText(100),
  contactPerson: optionalText(200),
  phone: optionalText(50),
  email: optionalText(200).refine(
    (value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
    "invalid e-mail",
  ),
  notes: optionalText(2000),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomerFormValues = z.input<typeof customerSchema>;

export const CUSTOMER_FIELDS = [
  "customerNumber",
  "name",
  "taxId",
  "address",
  "city",
  "country",
  "contactPerson",
  "phone",
  "email",
  "notes",
] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];
export type CustomerError = "name_taken" | "number_taken" | "number_of_archived";
export type CustomerActionResult = ActionResult<CustomerField, CustomerError>;

/** Row shape for public.customers (organization_id added by the caller). */
export function toCustomerRow(input: CustomerInput) {
  return {
    ...(input.customerNumber === null ? {} : { customer_number: input.customerNumber }),
    name: input.name,
    tax_id: input.taxId,
    address: input.address,
    city: input.city,
    country: input.country,
    contact_person: input.contactPerson,
    phone: input.phone,
    email: input.email,
    notes: input.notes,
  };
}
