"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, dbErrorKind, invalidFields, violates } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { numericParam } from "@/lib/supabase/numeric";
import {
  MATERIAL_FIELDS,
  MATERIAL_GROUP_FIELDS,
  materialGroupSchema,
  materialSchema,
  type MaterialActionResult,
  type MaterialField,
  type MaterialGroupActionResult,
  type MaterialGroupField,
} from "./schemas";

const failGroup = actionFail<MaterialGroupField, "name_taken">;
const failMaterial = actionFail<MaterialField, "designation_taken">;

function revalidateMaterialScreens() {
  revalidatePath("/settings/materials");
  revalidatePath("/products", "layout");
}

async function managerOrg(): Promise<string | null> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  return (await permitAction(organizationId, "products.manage")) ? organizationId : null;
}

function logUnexpected(error: unknown) {
  console.error("material write failed", error);
}

export async function saveMaterialGroupAction(
  id: unknown,
  input: unknown,
): Promise<MaterialGroupActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failGroup("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = materialGroupSchema.safeParse(input);
  if (!parsedId.success) return failGroup("invalid");
  if (!parsed.success)
    return failGroup("invalid", invalidFields(parsed.error, MATERIAL_GROUP_FIELDS));

  const row = { name: parsed.data.name, density_kg_dm3: numericParam(parsed.data.density) };
  const supabase = await createClient();
  const { data, error } = parsedId.data
    ? await supabase
        .from("material_groups")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("material_groups")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) {
    if (violates(error, "material_groups_name_key")) return failGroup("name_taken", ["name"]);
    if (dbErrorKind(error) === "denied") return failGroup("denied");
    logUnexpected(error);
    return failGroup("unexpected");
  }
  if (!data) return failGroup("not_found");

  revalidateMaterialScreens();
  return { ok: true, id: data.id };
}

export async function saveMaterialAction(
  id: unknown,
  input: unknown,
): Promise<MaterialActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failMaterial("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = materialSchema.safeParse(input);
  if (!parsedId.success) return failMaterial("invalid");
  if (!parsed.success) return failMaterial("invalid", invalidFields(parsed.error, MATERIAL_FIELDS));

  const row = {
    group_id: parsed.data.groupId,
    designation: parsed.data.designation,
    density_kg_dm3: numericParam(parsed.data.density),
  };
  const supabase = await createClient();
  const { data, error } = parsedId.data
    ? await supabase
        .from("materials")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("materials")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) {
    if (violates(error, "materials_designation_key")) {
      return failMaterial("designation_taken", ["designation"]);
    }
    if (dbErrorKind(error) === "foreign_key") return failMaterial("invalid", ["groupId"]);
    if (dbErrorKind(error) === "denied") return failMaterial("denied");
    logUnexpected(error);
    return failMaterial("unexpected");
  }
  if (!data) return failMaterial("not_found");

  revalidateMaterialScreens();
  return { ok: true, id: data.id };
}

/** Archive or restore a group (table "material_groups") or a designation ("materials"). */
export async function setMaterialArchivedAction(
  kind: unknown,
  id: unknown,
  archived: unknown,
): Promise<MaterialActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failMaterial("denied");

  const parsed = z
    .object({ kind: z.enum(["group", "material"]), id: z.uuid(), archived: z.boolean() })
    .safeParse({ kind, id, archived });
  if (!parsed.success) return failMaterial("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(parsed.data.kind === "group" ? "material_groups" : "materials")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    // Restoring next to an active item with the same name.
    if (dbErrorKind(error) === "unique") return failMaterial("designation_taken");
    logUnexpected(error);
    return failMaterial("unexpected");
  }
  if (data.length === 0) return failMaterial("not_found");

  revalidateMaterialScreens();
  return { ok: true, id: parsed.data.id };
}
