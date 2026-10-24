import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Test credentials (DEMO_PASSWORD, TEST_TENANT_PASSWORD) live in .env.local.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
