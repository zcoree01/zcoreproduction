// Permanent test tenants in the linked project, shared by DB and e2e tests.
// Never deleted (audit_log is append-only); setup is idempotent.
// The password comes from TEST_TENANT_PASSWORD in .env.local (not committed).
import { z } from "zod";

export const TEST_TENANTS = {
  a: { slug: "test-tenant-a", name: "Test Tenant A" },
  b: { slug: "test-tenant-b", name: "Test Tenant B" },
} as const;

export function testTenantPassword(env: NodeJS.ProcessEnv = process.env): string {
  return z
    .string({ error: "TEST_TENANT_PASSWORD is missing in .env.local" })
    .min(12, "TEST_TENANT_PASSWORD must have at least 12 characters")
    .parse(env.TEST_TENANT_PASSWORD);
}
