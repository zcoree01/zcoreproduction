// DEMO ONLY. These credentials are documented in docs/STATUS.md and are public.
// Shared by the seed script and the Playwright tests.
import type { ProvisionUserInput } from "@/modules/organizations/provision";

export const DEMO_ORG = { slug: "demo", name: "Demo Metal d.o.o." } as const;

export const DEMO_USERS = [
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
] as const satisfies readonly ProvisionUserInput[];
