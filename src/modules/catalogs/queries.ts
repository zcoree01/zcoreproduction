import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CatalogKind } from "./schemas";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheLife, cacheTag } from "next/cache";
import { ORG_CACHE_LIFE, orgCacheVersion, orgCacheTag } from "@/lib/cache/org-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export type CatalogItem = { id: string; name: string; archived: boolean };
export type CatalogOption = { id: string; name: string };

/** All items of one kind (archived last), for the catalog settings screen. */
export async function listCatalogItems(
  organizationId: string,
  kind: CatalogKind,
): Promise<CatalogItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name, archived_at")
    .eq("organization_id", organizationId)
    .eq("kind", kind)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name");
  if (error) throw error;
  return data.map((row) => ({ id: row.id, name: row.name, archived: row.archived_at !== null }));
}

/** Active items of the given kinds, for selects and filters. */
export async function listCatalogOptions<K extends CatalogKind>(
  organizationId: string,
  kinds: readonly K[],
): Promise<Record<K, CatalogOption[]>> {
  const version = await orgCacheVersion(organizationId, "member", ["catalogs"]);
  if (version !== null) return cachedListCatalogOptions(organizationId, kinds, version);
  return loadListCatalogOptions(await createClient(), organizationId, kinds);
}

async function cachedListCatalogOptions<K extends CatalogKind>(
  organizationId: string,
  kinds: readonly K[],
  version: string,
): Promise<Record<K, CatalogOption[]>> {
  "use cache: remote";
  // `version` is part of the cache key only (org_cache_versions).
  void version;
  cacheTag(orgCacheTag(organizationId, "catalogs"));
  cacheLife(ORG_CACHE_LIFE);
  return loadListCatalogOptions(createAdminClient(), organizationId, kinds);
}

async function loadListCatalogOptions<K extends CatalogKind>(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  kinds: readonly K[],
): Promise<Record<K, CatalogOption[]>> {
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, kind, name")
    .eq("organization_id", organizationId)
    .in("kind", [...kinds])
    .is("archived_at", null)
    .order("name");
  if (error) throw error;

  const options = Object.fromEntries(kinds.map((kind) => [kind, [] as CatalogOption[]])) as Record<
    K,
    CatalogOption[]
  >;
  for (const row of data) {
    options[row.kind as K]?.push({ id: row.id, name: row.name });
  }
  return options;
}
