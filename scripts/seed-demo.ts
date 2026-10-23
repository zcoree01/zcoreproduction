// Seeds the "demo" organization with one user per system role.
// Idempotent: safe to run repeatedly (existing users get their password reset).
// Usage: npm run seed:demo
//
// DEMO ONLY. These credentials are documented in docs/STATUS.md and are public.
// Never reuse this pattern for a real customer organization.
import type { ProvisionUserInput } from "@/modules/organizations/provision";
import { ensureOrganization, ensureUser } from "@/modules/organizations/provision";
import { createAdminClient } from "./lib/admin-client";

const DEMO_USERS: ProvisionUserInput[] = [
  { username: "admin", password: "Demo-FDqqz3pO", fullName: "Amir Admin", role: "admin" },
  { username: "direktor", password: "Demo-Pic6xDHu", fullName: "Dina Direktor", role: "director" },
  {
    username: "sef.proizvodnje",
    password: "Demo-7AQcd2ap",
    fullName: "Senad Šef",
    role: "head_of_production",
  },
  {
    username: "skladiste",
    password: "Demo-Y3bwUg7I",
    fullName: "Selma Skladište",
    role: "warehouse",
  },
  { username: "operater", password: "Demo-BdVkdG3n", fullName: "Omer Operater", role: "operator" },
];

async function main() {
  const admin = createAdminClient();
  const org = await ensureOrganization(admin, { slug: "demo", name: "Demo Metal d.o.o." });
  console.log(`organization demo: ${org.id}`);

  for (const user of DEMO_USERS) {
    const id = await ensureUser(admin, org, user);
    console.log(`  ${user.role.padEnd(18)} ${user.username.padEnd(16)} ${id}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
