import { defineConfig, devices } from "@playwright/test";
import { loadTestEnv } from "./scripts/lib/test-env.mts";

// Runs against the local Docker Supabase (D-052): .env.local is the base
// (DEMO_PASSWORD, TEST_TENANT_PASSWORD), .env.test.local points at the local DB.
// The same env goes to the dev server, which never overrides process env.
const testEnv = loadTestEnv();
Object.assign(process.env, testEnv);

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Serial: a sign-in revokes the user's other sessions (one session per user,
  // D-013), and many tests sign in as the same demo users.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    // Only tests tagged @mobile: shop-floor flows. Keeps sign-ins under the
    // Supabase Auth rate limit.
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: "npm run dev",
    url: `${baseURL}/login`,
    env: { ...testEnv, ZCORE_DEV_FS_CACHE: "off" },
    // Never reuse a running dev server: it may be connected to production.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
