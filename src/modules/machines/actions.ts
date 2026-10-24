"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, dbErrorKind, invalidFields, violates } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  MACHINE_FIELDS,
  machineSchema,
  machineStatusSchema,
  toMachineRow,
  type MachineActionResult,
  type MachineField,
} from "./schemas";

const fail = actionFail<MachineField, "code_taken" | "invalid_reference">;

function revalidateMachineScreens() {
  revalidatePath("/machines");
  revalidatePath("/employees");
  revalidatePath("/floor/machines");
}

function mapWriteError(error: { code?: string; message?: string }): MachineActionResult {
  if (violates(error, "machines_code_key")) return fail("code_taken", ["code"]);
  switch (dbErrorKind(error)) {
    case "foreign_key":
      // Type or location of another organization, or of the wrong kind.
      return fail("invalid_reference", ["typeId", "locationId"]);
    case "denied":
      return fail("denied");
    case "not_found":
      return fail("not_found");
    default:
      console.error("machine write failed", error);
      return fail("unexpected");
  }
}

/** Creates (id null) or updates a machine. `input` comes from the client: re-validated. */
export async function saveMachineAction(id: unknown, input: unknown): Promise<MachineActionResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "machines.manage"))) return fail("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = machineSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, MACHINE_FIELDS));

  const supabase = await createClient();
  const row = toMachineRow(parsed.data);
  const { data, error } = parsedId.data
    ? await supabase
        .from("machines")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .is("archived_at", null)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("machines")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) return mapWriteError(error);
  if (!data) return fail("not_found");

  revalidateMachineScreens();
  return { ok: true, id: data.id };
}

/** Archive (hide from lists and selects) or restore a machine. */
export async function setMachineArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<MachineActionResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "machines.manage"))) return fail("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machines")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return mapWriteError(error);
  if (data.length === 0) return fail("not_found");

  revalidateMachineScreens();
  return { ok: true, id: parsed.data.id };
}

/**
 * Quick status change (management table and shop floor). Managers need
 * machines.manage, operators machines.status.update. The database function
 * enforces the exact rules (qualified machines only, never 'inactive').
 */
export async function setMachineStatusAction(
  id: unknown,
  status: unknown,
): Promise<MachineActionResult> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const allowed =
    (await permitAction(organizationId, "machines.manage")) ||
    (await permitAction(organizationId, "machines.status.update"));
  if (!allowed) return fail("denied");

  const parsed = z.object({ id: z.uuid(), status: machineStatusSchema }).safeParse({ id, status });
  if (!parsed.success) return fail("invalid", ["status"]);

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_machine_status", {
    p_machine_id: parsed.data.id,
    p_status: parsed.data.status,
  });
  if (error) return mapWriteError(error);

  revalidateMachineScreens();
  return { ok: true, id: parsed.data.id };
}
