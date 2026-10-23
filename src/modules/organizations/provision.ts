import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SYSTEM_ROLE_KEYS } from "@/lib/auth/roles";
import { toAuthEmail, usernameSchema } from "@/lib/auth/username";
import type { Database } from "@/lib/supabase/types";
import { createOrganizationSchema, type CreateOrganizationInput } from "./schemas";

// Tenant provisioning. Requires a service-role client, so it must only run in
// trusted contexts (seed scripts, tests, future platform admin). It never
// creates the client itself and never reads secrets.
type AdminClient = SupabaseClient<Database>;

export type ProvisionedOrganization = { id: string; slug: string };

export async function ensureOrganization(
  admin: AdminClient,
  input: CreateOrganizationInput,
): Promise<ProvisionedOrganization> {
  const org = createOrganizationSchema.parse(input);

  const existing = await admin
    .from("organizations")
    .select("id, slug")
    .eq("slug", org.slug)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  // Roles, role permissions and the core module are created by a DB trigger.
  const created = await admin
    .from("organizations")
    .insert({ slug: org.slug, name: org.name, timezone: org.timezone })
    .select("id, slug")
    .single();
  if (created.error) throw created.error;
  return created.data;
}

export const provisionUserSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8),
  fullName: z.string().trim().min(1).max(200),
  role: z.enum(SYSTEM_ROLE_KEYS),
});

export type ProvisionUserInput = z.input<typeof provisionUserSchema>;

/**
 * Creates the auth user (profile + membership are created atomically by the
 * on_auth_user_created trigger). Idempotent: an existing user gets its
 * password reset to the given one, so seed/test credentials stay valid.
 */
export async function ensureUser(
  admin: AdminClient,
  org: ProvisionedOrganization,
  input: ProvisionUserInput,
): Promise<string> {
  const user = provisionUserSchema.parse(input);

  const existing = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", org.id)
    .eq("username", user.username)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const updated = await admin.auth.admin.updateUserById(existing.data.id, {
      password: user.password,
    });
    if (updated.error) throw updated.error;
    return existing.data.id;
  }

  const created = await admin.auth.admin.createUser({
    email: toAuthEmail(user.username, org.slug),
    password: user.password,
    email_confirm: true,
    app_metadata: { organization_id: org.id, username: user.username, role: user.role },
    user_metadata: { full_name: user.fullName },
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}
