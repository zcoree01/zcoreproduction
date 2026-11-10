import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Environment for npm run test:db and npm run e2e (D-052).
// .env.local is the base (passwords, cron secret); .env.test.local overrides it
// with the local Docker Supabase (npm run db:start). The tests write and delete
// rows, so they refuse to run against anything but a local database unless
// ALLOW_REMOTE_TEST_DB=1 is set explicitly.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function loadTestEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of [".env.local", ".env.test.local"]) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (value !== undefined) env[key] = value;
    }
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const host = URL.canParse(url) ? new URL(url).hostname : "";
  if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `Tests refuse to run against ${host || "an unknown database"}: start the local ` +
        "database (npm run db:start) and fill .env.test.local (see .env.example), " +
        "or set ALLOW_REMOTE_TEST_DB=1 if you really mean a remote project.",
    );
  }
  return env;
}
