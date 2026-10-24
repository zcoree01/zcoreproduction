import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalText, requiredText } from "@/lib/forms";

// Shared by the client form (react-hook-form) and the server action.
// Limits mirror the CHECKs on public.customers.
export const customerSchema = z.object({
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
export type CustomerActionResult = ActionResult<CustomerField, "name_taken">;

/** Row shape for public.customers (organization_id added by the caller). */
export function toCustomerRow(input: CustomerInput) {
  return {
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
