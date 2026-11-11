import "server-only";
import { createClient } from "@/lib/supabase/server";

// Firms whose permanent deletion failed (D-055); platform.read is checked in
// the database.

export type PurgeFailure = {
  organizationId: string;
  name: string;
  slug: string;
  deleteAfter: string;
  firstFailedAt: string;
  lastFailedAt: string;
  attempts: number;
  error: string;
};

export async function listPurgeFailures(): Promise<PurgeFailure[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_purge_failures");
  if (error) throw error;
  return data.map((row) => ({
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    deleteAfter: row.delete_after,
    firstFailedAt: row.first_failed_at,
    lastFailedAt: row.last_failed_at,
    attempts: row.attempts,
    error: row.error,
  }));
}
