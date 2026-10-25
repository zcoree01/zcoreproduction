"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, dbErrorKind, invalidFields, violates } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  CUSTOMER_FIELDS,
  customerSchema,
  toCustomerRow,
  type CustomerActionResult,
  type CustomerError,
  type CustomerField,
} from "./schemas";

const fail = actionFail<CustomerField, CustomerError>;

function revalidateCustomerScreens() {
  revalidatePath("/customers", "layout");
  revalidatePath("/products", "layout");
  revalidatePath("/orders", "layout");
}

function mapWriteError(error: { code?: string; message?: string }): CustomerActionResult {
  if (violates(error, "customers_name_key")) return fail("name_taken", ["name"]);
  if (violates(error, "customers_number_key")) return fail("number_taken", ["customerNumber"]);
  switch (dbErrorKind(error)) {
    case "denied":
      return fail("denied");
    case "not_found":
      return fail("not_found");
    default:
      if (error.code === "23514") return fail("invalid");
      console.error("customer write failed", error);
      return fail("unexpected");
  }
}

/**
 * Creates (id null) or updates a customer. `input` comes from the client:
 * re-validated. Taking over the number of an archived customer needs
 * `confirmReuse` (its orders stay with the archived customer).
 */
export async function saveCustomerAction(
  id: unknown,
  input: unknown,
  confirmReuse: unknown = false,
): Promise<CustomerActionResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "customers.manage"))) return fail("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = customerSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, CUSTOMER_FIELDS));

  const supabase = await createClient();
  const number = parsed.data.customerNumber;
  if (number !== null && confirmReuse !== true) {
    const holders = await supabase
      .from("customers")
      .select("id, archived_at")
      .eq("organization_id", organizationId)
      .eq("customer_number", number);
    if (holders.error) return mapWriteError(holders.error);
    const others = holders.data.filter((holder) => holder.id !== parsedId.data);
    if (others.some((holder) => holder.archived_at === null)) {
      return fail("number_taken", ["customerNumber"]);
    }
    if (others.length > 0) return fail("number_of_archived", ["customerNumber"]);
  }
  const row = toCustomerRow(parsed.data);
  const { data, error } = parsedId.data
    ? await supabase
        .from("customers")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .is("archived_at", null)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("customers")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) return mapWriteError(error);
  if (!data) return fail("not_found");

  revalidateCustomerScreens();
  return { ok: true, id: data.id };
}

/** Archive or restore; products keep their customer. */
export async function setCustomerArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<CustomerActionResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "customers.manage"))) return fail("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return mapWriteError(error);
  if (data.length === 0) return fail("not_found");

  revalidateCustomerScreens();
  return { ok: true, id: parsed.data.id };
}
