import "server-only";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import type { MaterialOption } from "./schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheLife, cacheTag } from "next/cache";
import { ORG_CACHE_LIFE, orgCacheVersion, orgCacheTag } from "@/lib/cache/org-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export type MaterialGroup = {
  id: string;
  name: string;
  density: string | null;
  archived: boolean;
  materials: { id: string; designation: string; density: string | null; archived: boolean }[];
};

/** All groups with their designations (archived last), for the settings screen. */
export async function listMaterialGroups(organizationId: string): Promise<MaterialGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_groups")
    .select(
      "id, name, density_kg_dm3, archived_at, materials(id, designation, density_kg_dm3, archived_at)",
    )
    .eq("organization_id", organizationId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name");
  if (error) throw error;

  return data.map((group) => ({
    id: group.id,
    name: group.name,
    density: decimalFromDb(group.density_kg_dm3),
    archived: group.archived_at !== null,
    materials: group.materials
      .map((material) => ({
        id: material.id,
        designation: material.designation,
        density: decimalFromDb(material.density_kg_dm3),
        archived: material.archived_at !== null,
      }))
      .sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          a.designation.localeCompare(b.designation, "bs"),
      ),
  }));
}

/** Active designations with group name and effective density, for the material picker. */
export async function listMaterialOptions(organizationId: string): Promise<MaterialOption[]> {
  const version = await orgCacheVersion(organizationId, "member", ["materials"]);
  if (version !== null) return cachedListMaterialOptions(organizationId, version);
  return loadListMaterialOptions(await createClient(), organizationId);
}

async function cachedListMaterialOptions(
  organizationId: string,
  version: string,
): Promise<MaterialOption[]> {
  "use cache: remote";
  // `version` is part of the cache key only (org_cache_versions).
  void version;
  cacheTag(orgCacheTag(organizationId, "materials"));
  cacheLife(ORG_CACHE_LIFE);
  return loadListMaterialOptions(createAdminClient(), organizationId);
}

async function loadListMaterialOptions(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<MaterialOption[]> {
  const { data, error } = await supabase
    .from("materials")
    .select(
      "id, designation, density_kg_dm3, group:material_groups!inner(name, density_kg_dm3, archived_at)",
    )
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .is("group.archived_at", null)
    .order("designation");
  if (error) throw error;

  return data
    .map((row) => ({
      id: row.id,
      designation: row.designation,
      groupName: row.group.name,
      density: decimalFromDb(row.density_kg_dm3) ?? decimalFromDb(row.group.density_kg_dm3),
    }))
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName, "bs") ||
        a.designation.localeCompare(b.designation, "bs"),
    );
}
