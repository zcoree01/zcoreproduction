import { toAuthEmail } from "@/lib/auth/username";
import type { CreateUserInput } from "./schemas";

export type CreateAuthUserResult =
  { ok: true; userId: string } | { ok: false; code: string | undefined; message: string };

// Side effects are injected so the rules below are testable without Supabase.
export interface CreateUserDeps {
  /** Role lookup as the acting user (RLS: only roles of their organization). */
  findRole(roleId: string): Promise<{ key: string } | null>;
  /** Auth Admin API (service role). */
  createAuthUser(input: {
    email: string;
    password: string;
    appMetadata: { organization_id: string; username: string; role: string };
    fullName: string;
  }): Promise<CreateAuthUserResult>;
  /** Explicit audit entry as the acting user. */
  audit(entry: { action: string; entityId: string; after: Record<string, string> }): Promise<void>;
}

export type CreateOrgUserResult =
  { ok: true; userId: string } | { ok: false; error: "username_taken" | "role_not_found" };

/**
 * Creates a user in `org`. The caller must have checked `users.manage`.
 * Profile + membership are created atomically by the on_auth_user_provision
 * trigger; the trigger also rejects roles of other organizations.
 */
export async function createOrgUser(
  deps: CreateUserDeps,
  org: { id: string; slug: string },
  input: CreateUserInput,
): Promise<CreateOrgUserResult> {
  const role = await deps.findRole(input.roleId);
  if (!role) return { ok: false, error: "role_not_found" };

  const created = await deps.createAuthUser({
    email: toAuthEmail(input.username, org.slug),
    password: input.password,
    appMetadata: { organization_id: org.id, username: input.username, role: role.key },
    fullName: input.fullName,
  });
  if (!created.ok) {
    if (created.code === "email_exists" || created.code === "user_already_exists") {
      return { ok: false, error: "username_taken" };
    }
    throw new Error(`Creating auth user failed: ${created.message}`);
  }

  await deps.audit({
    action: "users.create",
    entityId: created.userId,
    after: { username: input.username, full_name: input.fullName, role: role.key },
  });

  return { ok: true, userId: created.userId };
}
