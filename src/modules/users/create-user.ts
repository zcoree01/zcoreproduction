import { toAuthEmail } from "@/lib/auth/username";
import { pickUsername, usernameCandidates } from "./username-suggest";

export type CreateAuthUserResult =
  { ok: true; userId: string } | { ok: false; code: string | undefined; message: string };

// Side effects are injected so the rules below are testable without Supabase.
export interface CreateUserDeps {
  /** Role lookup as the acting user (RLS: only roles of their organization). */
  findRole(roleId: string): Promise<{ key: string } | null>;
  /** Which of `usernames` already exist in the organization (incl. deactivated users). */
  takenUsernames(usernames: string[]): Promise<Set<string>>;
  /** Temporary password the user must replace at the first sign-in. */
  generatePassword(): string;
  /** Auth Admin API (service role). */
  createAuthUser(input: {
    email: string;
    password: string;
    appMetadata: {
      organization_id: string;
      username: string;
      role: string;
      must_change_password: true;
    };
    fullName: string;
  }): Promise<CreateAuthUserResult>;
  /** Explicit audit entry as the acting user. */
  audit(entry: { action: string; entityId: string; after: Record<string, string> }): Promise<void>;
}

export type NewOrgUser = {
  /** Null = generate from the name (ime.p, ime.pr, …). */
  username: string | null;
  fullName: string;
  /** Name parts used to generate the username. */
  firstName: string;
  lastName: string;
  roleId: string;
};

export type CreateOrgUserResult =
  | { ok: true; userId: string; username: string; password: string }
  | { ok: false; error: "username_taken" | "role_not_found" };

// A generated name can be taken between the lookup and the insert.
const MAX_ATTEMPTS = 5;

/**
 * Creates a user in `org` with a temporary password. The caller must have
 * checked `users.manage`. Profile + membership (with must_change_password)
 * are created atomically by the on_auth_user_provision trigger; the trigger
 * also rejects roles of other organizations.
 */
export async function createOrgUser(
  deps: CreateUserDeps,
  org: { id: string; slug: string },
  input: NewOrgUser,
): Promise<CreateOrgUserResult> {
  const role = await deps.findRole(input.roleId);
  if (!role) return { ok: false, error: "role_not_found" };

  const candidates = input.username
    ? [input.username]
    : usernameCandidates(input.firstName, input.lastName);
  const taken = input.username ? new Set<string>() : await deps.takenUsernames(candidates);
  const password = deps.generatePassword();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const username = pickUsername(candidates, taken);
    if (!username) break;

    const created = await deps.createAuthUser({
      email: toAuthEmail(username, org.slug),
      password,
      appMetadata: {
        organization_id: org.id,
        username,
        role: role.key,
        must_change_password: true,
      },
      fullName: input.fullName,
    });
    if (!created.ok) {
      if (created.code === "email_exists" || created.code === "user_already_exists") {
        taken.add(username);
        continue;
      }
      throw new Error(`Creating auth user failed: ${created.message}`);
    }

    await deps.audit({
      action: "users.create",
      entityId: created.userId,
      after: { username, full_name: input.fullName, role: role.key },
    });
    return { ok: true, userId: created.userId, username, password };
  }

  return { ok: false, error: "username_taken" };
}
