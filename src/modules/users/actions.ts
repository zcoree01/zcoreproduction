"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { PermissionDeniedError, UnauthenticatedError } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createOrgUser } from "./create-user";
import {
  CREATE_USER_FIELDS,
  createUserSchema,
  type CreateUserError,
  type CreateUserField,
  type CreateUserResult,
} from "./schemas";

const fail = (error: CreateUserError, fields: CreateUserField[] = []): CreateUserResult => ({
  ok: false,
  error,
  fields,
});

// `input` comes from the client: always re-validated here.
export async function createUserAction(input: unknown): Promise<CreateUserResult> {
  const member = await requireMember();
  try {
    await requirePermission(member.organization.id, "users.manage");
  } catch (error) {
    if (error instanceof PermissionDeniedError || error instanceof UnauthenticatedError) {
      return fail("denied");
    }
    throw error;
  }

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    return fail(
      "invalid",
      CREATE_USER_FIELDS.filter((field) => fields.has(field)),
    );
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const organizationId = member.organization.id;

  try {
    const result = await createOrgUser(
      {
        async findRole(roleId) {
          const { data, error } = await supabase
            .from("roles")
            .select("key")
            .eq("id", roleId)
            .eq("organization_id", organizationId)
            .is("archived_at", null)
            .maybeSingle();
          if (error) throw error;
          return data;
        },
        async createAuthUser({ email, password, appMetadata, fullName }) {
          const { data, error } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: appMetadata,
            user_metadata: { full_name: fullName },
          });
          return error
            ? { ok: false, code: error.code, message: error.message }
            : { ok: true, userId: data.user.id };
        },
        audit: ({ action, entityId, after }) =>
          writeAudit(supabase, {
            organizationId,
            action,
            entityType: "profiles",
            entityId,
            after,
          }),
      },
      member.organization,
      parsed.data,
    );

    if (!result.ok) {
      return fail(result.error, result.error === "username_taken" ? ["username"] : ["roleId"]);
    }
  } catch (error) {
    console.error("createUserAction failed", error);
    return fail("unexpected");
  }

  revalidatePath("/admin/users");
  return { ok: true, username: parsed.data.username };
}
