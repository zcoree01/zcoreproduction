// Seeds the "demo" organization with one user per system role.
// Idempotent: safe to run repeatedly (existing users get their password reset).
// Usage: npm run seed:demo
//
// DEMO ONLY. All demo users get DEMO_PASSWORD from .env.local (not committed).
// Never reuse this pattern for a real customer organization.
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { createAdminClient } from "./lib/admin-client";
import { DEMO_ORG, DEMO_USERS, demoPassword } from "./lib/demo-users";

async function main() {
  const password = demoPassword();
  const admin = createAdminClient();
  const org = await ensureOrganization(admin, DEMO_ORG);
  console.log(`organization ${org.slug}: ${org.id}`);

  for (const user of DEMO_USERS) {
    const id = await ensureUser(admin, org, { ...user, password });
    console.log(`  ${user.role.padEnd(18)} ${user.username.padEnd(16)} ${id}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
