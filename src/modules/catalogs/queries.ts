import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CatalogKind } from "./schemas";

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
  const supabase = await createClient();
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
