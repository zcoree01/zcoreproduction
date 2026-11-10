import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./scripts/lib/test-env.mts";

// Integration tests (RLS, triggers) against the local Docker Supabase (D-052).
// Needs npm run db:start and .env.test.local. Run: npm run test:db
export default defineConfig(() => ({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    env: loadTestEnv(),
    // One shared fixture (two tenants); run files sequentially against one DB.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
}));
