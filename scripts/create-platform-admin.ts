// Creates (or re-activates) a Zcore platform admin in the "zcore"
// organization (D-026). The user gets a temporary password and must choose
// their own at the first sign-in.
//
// Usage: npm run platform:admin -- <username> "<Ime Prezime>"
// Sign in at zcore.zcore.ba (local: http://localhost:3000/login?org=zcore).
import { usernameSchema } from "@/lib/auth/username";
import { ensureOrganization } from "@/modules/organizations/provision";
import { generateTempPassword } from "@/modules/users/temp-password";
import { toAuthEmail } from "@/lib/auth/username";
import { createAdminClient } from "./lib/admin-client";

async function main() {
  const [rawUsername, fullName] = process.argv.slice(2);
  const username = usernameSchema.parse(rawUsername);
  if (!fullName?.trim())
    throw new Error('Usage: npm run platform:admin -- <username> "<Ime Prezime>"');

  const admin = createAdminClient();
  const org = await ensureOrganization(admin, { slug: "zcore", name: "Zcore" });
  const password = generateTempPassword();

  const existing = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", org.id)
    .eq("username", username)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const updated = await admin.auth.admin.updateUserById(existing.data.id, { password });
    if (updated.error) throw updated.error;
    const flags = await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", existing.data.id);
    if (flags.error) throw flags.error;
    const membership = await admin
      .from("memberships")
      .update({ archived_at: null })
      .eq("user_id", existing.data.id);
    if (membership.error) throw membership.error;
  } else {
    const created = await admin.auth.admin.createUser({
      email: toAuthEmail(username, org.slug),
      password,
      email_confirm: true,
      app_metadata: {
        organization_id: org.id,
        username,
        role: "admin",
        must_change_password: true,
      },
      user_metadata: { full_name: fullName.trim() },
    });
    if (created.error) throw created.error;
  }

  console.log(`platform admin ${username} (zcore)`);
  console.log(`temporary password: ${password}  (must be changed at the first sign-in)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
