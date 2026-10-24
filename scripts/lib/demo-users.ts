// Demo organization and users, shared by the seed script and Playwright tests.
// The password is NOT in the repository: it comes from DEMO_PASSWORD in
// .env.local (all demo users share it; `npm run seed:demo` applies it).
import { z } from "zod";

export const DEMO_ORG = { slug: "demo", name: "Demo Metal d.o.o." } as const;

export const DEMO_USERS = [
  { username: "admin", fullName: "Amir Admin", role: "admin" },
  { username: "direktor", fullName: "Dina Direktor", role: "director" },
  { username: "sef.proizvodnje", fullName: "Senad Šef", role: "head_of_production" },
  { username: "skladiste", fullName: "Selma Skladište", role: "warehouse" },
  { username: "operater", fullName: "Omer Operater", role: "operator" },
] as const;

export function demoPassword(env: NodeJS.ProcessEnv = process.env): string {
  return z
    .string({ error: "DEMO_PASSWORD is missing in .env.local" })
    .min(12, "DEMO_PASSWORD must have at least 12 characters")
    .parse(env.DEMO_PASSWORD);
}
