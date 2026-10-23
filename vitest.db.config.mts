import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests against the linked Supabase project (RLS, triggers).
// Needs .env.local with URL, anon key and service-role key. Run: npm run test:db
export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    env: loadEnv(mode, process.cwd(), ""),
    // One shared fixture (two tenants); run files sequentially against the remote DB.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
}));
