import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Zcore platform administration (D-026): registered organizations and their
// modules only, never tenant data. Every RPC checks platform.manage itself.

const modulesSchema = z.array(
  z.object({ key: z.string(), enabled: z.boolean(), active_until: z.string().nullable() }),
);
const companySchema = z
  .object({
    tax_id: z.string(),
    country: z.string(),
    city: z.string().nullable(),
    name: z.string(),
  })
  .nullable();

export type PlatformModule = { key: string; enabled: boolean; activeUntil: string | null };

export type PlatformOrganization = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  archived: boolean;
  memberCount: number;
  company: { taxId: string; country: string; city: string | null; name: string } | null;
  claimPending: boolean;
  modules: PlatformModule[];
};

export async function listPlatformOrganizations(): Promise<PlatformOrganization[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_organizations");
  if (error) throw error;
  return data.map((row) => {
    const company = companySchema.parse(row.company);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      createdAt: row.created_at,
      archived: row.archived,
      memberCount: row.member_count,
      company: company
        ? {
            taxId: company.tax_id,
            country: company.country,
            city: company.city,
            name: company.name,
          }
        : null,
      claimPending: row.claim_pending,
      modules: modulesSchema.parse(row.modules).map((m) => ({
        key: m.key,
        enabled: m.enabled,
        activeUntil: m.active_until,
      })),
    };
  });
}

export async function getPlatformSettings(): Promise<{ defaultTrialDays: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_get_settings");
  if (error) throw error;
  const parsed = z.object({ default_trial_days: z.number().int() }).parse(data);
  return { defaultTrialDays: parsed.default_trial_days };
}
