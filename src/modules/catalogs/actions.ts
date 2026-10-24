"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, dbErrorKind, invalidFields } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  CATALOG_MANAGE_PERMISSION,
  catalogItemNameSchema,
  catalogKindSchema,
  type CatalogActionResult,
  type CatalogItemField,
  type CatalogKind,
} from "./schemas";

const FIELDS: readonly CatalogItemField[] = ["name"];
const fail = actionFail<CatalogItemField, "name_taken">;

// Lists that show catalog names.
function revalidateCatalogScreens() {
  revalidatePath("/settings/catalogs");
  revalidatePath("/machines");
  revalidatePath("/employees");
}

function mapWriteError(error: { code?: string; message?: string }): CatalogActionResult {
  switch (dbErrorKind(error)) {
    case "unique":
      return fail("name_taken", ["name"]);
    case "denied":
      return fail("denied");
    default:
      console.error("catalog write failed", error);
      return fail("unexpected");
  }
}

export async function createCatalogItemAction(
  kind: unknown,
  input: unknown,
): Promise<CatalogActionResult> {
  const member = await requireMember();
  const parsedKind = catalogKindSchema.safeParse(kind);
  if (!parsedKind.success) return fail("invalid");
  if (!(await permitAction(member.organization.id, CATALOG_MANAGE_PERMISSION[parsedKind.data]))) {
    return fail("denied");
  }

  const parsed = catalogItemNameSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, FIELDS));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .insert({
      organization_id: member.organization.id,
      kind: parsedKind.data,
      name: parsed.data.name,
    })
    .select("id")
    .single();
  if (error) return mapWriteError(error);

  revalidateCatalogScreens();
  return { ok: true, id: data.id };
}

/** Kind of an item of the member's organization (RLS), or null. */
async function findItemKind(organizationId: string, id: string): Promise<CatalogKind | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("kind")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const kind = catalogKindSchema.safeParse(data?.kind);
  return kind.success ? kind.data : null;
}

async function updateItem(
  id: unknown,
  patch: { name?: string; archived_at?: string | null },
): Promise<CatalogActionResult> {
  const member = await requireMember();
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return fail("invalid");

  const kind = await findItemKind(member.organization.id, parsedId.data);
  if (!kind) return fail("not_found");
  if (!(await permitAction(member.organization.id, CATALOG_MANAGE_PERMISSION[kind]))) {
    return fail("denied");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .update(patch)
    .eq("organization_id", member.organization.id)
    .eq("id", parsedId.data)
    .select("id");
  if (error) return mapWriteError(error);
  if (data.length === 0) return fail("not_found");

  revalidateCatalogScreens();
  return { ok: true, id: parsedId.data };
}

export async function renameCatalogItemAction(
  id: unknown,
  input: unknown,
): Promise<CatalogActionResult> {
  const parsed = catalogItemNameSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, FIELDS));
  return updateItem(id, { name: parsed.data.name });
}

/**
 * Archived items disappear from selects; records that already use them keep
 * the reference (archive, don't delete). Restoring can collide with an active
 * item of the same name → name_taken.
 */
export async function setCatalogItemArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<CatalogActionResult> {
  const parsed = z.boolean().safeParse(archived);
  if (!parsed.success) return fail("invalid");
  return updateItem(id, { archived_at: parsed.data ? new Date().toISOString() : null });
}
