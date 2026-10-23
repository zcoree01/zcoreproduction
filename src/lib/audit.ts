import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/supabase/types";

export const auditEntrySchema = z.object({
  organizationId: z.uuid(),
  action: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).optional(),
  before: z.json().optional(),
  after: z.json().optional(),
});

export type AuditEntry = z.input<typeof auditEntrySchema>;

// Writes an explicit audit row as the signed-in user (actor = auth.uid()).
// Changes to organizations, roles, role_permissions, memberships and
// org_modules are already audited by database triggers.
export async function writeAudit(client: SupabaseClient<Database>, entry: AuditEntry) {
  const parsed = auditEntrySchema.parse(entry);
  const { error } = await client.rpc("write_audit", {
    p_org_id: parsed.organizationId,
    p_action: parsed.action,
    p_entity_type: parsed.entityType,
    p_entity_id: parsed.entityId,
    p_before: parsed.before as Json | undefined,
    p_after: parsed.after as Json | undefined,
  });
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}
