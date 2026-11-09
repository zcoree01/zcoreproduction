import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Permanent deletion of firms whose 30-day undo has passed (D-049). Run daily
// by the Vercel Cron route with the service-role client. The database refuses
// any firm that is not archived and due (public.purge_organization).

/** Buckets whose objects are stored under `<organization_id>/…`. */
export const ORGANIZATION_BUCKETS = [
  "product-files",
  "stock-certificates",
  "organization-files",
  "absence-documents",
] as const;

const LIST_PAGE = 100;
const REMOVE_BATCH = 500;

export type PurgeResult = { purged: string[]; failed: { id: string; error: string }[] };

/** `Authorization: Bearer <CRON_SECRET>`; never authorized without a secret. */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || header === null) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function purgeDueOrganizations(
  service: SupabaseClient<Database>,
  now: Date,
): Promise<PurgeResult> {
  const due = await service
    .from("organizations")
    .select("id")
    .not("archived_at", "is", null)
    .lte("delete_after", now.toISOString())
    .eq("is_platform", false)
    .order("delete_after");
  if (due.error) throw new Error(due.error.message);

  const result: PurgeResult = { purged: [], failed: [] };
  for (const { id } of due.data) {
    try {
      for (const bucket of ORGANIZATION_BUCKETS) {
        await removeFolder(service, bucket, id);
      }
      const { data, error } = await service.rpc("purge_organization", { p_org_id: id });
      if (error) throw new Error(error.message);
      if (data) result.purged.push(id);
    } catch (e) {
      result.failed.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

/** Removes every object under `<prefix>/` (folders nest), listing in pages. */
async function removeFolder(service: SupabaseClient<Database>, bucket: string, prefix: string) {
  const storage = service.storage.from(bucket);
  const files: string[] = [];
  const folders = [prefix];
  while (folders.length > 0) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await storage.list(folder, { limit: LIST_PAGE, offset });
      if (error) throw new Error(`${bucket}: ${error.message}`);
      for (const entry of data) {
        // Folders are listed without an id.
        if (entry.id === null) folders.push(`${folder}/${entry.name}`);
        else files.push(`${folder}/${entry.name}`);
      }
      if (data.length < LIST_PAGE) break;
    }
  }
  for (let i = 0; i < files.length; i += REMOVE_BATCH) {
    const { error } = await storage.remove(files.slice(i, i + REMOVE_BATCH));
    if (error) throw new Error(`${bucket}: ${error.message}`);
  }
}
