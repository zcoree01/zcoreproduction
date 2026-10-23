// Permanent test tenants in the linked project, shared by DB and e2e tests.
// Never deleted (audit_log is append-only); setup is idempotent.
export const TEST_TENANT_PASSWORD = "Test-Tenant-Isolation-2026";

export const TEST_TENANTS = {
  a: { slug: "test-tenant-a", name: "Test Tenant A" },
  b: { slug: "test-tenant-b", name: "Test Tenant B" },
} as const;
