import { describe, expect, it } from "vitest";
import { createAdminClient } from "../../scripts/lib/admin-client";
import { signIn } from "./fixtures";
import { TEST_TENANTS } from "../shared/test-tenants";

// Rule 1 and D-049 (D-059): every public table with organization_id has row
// level security and the lock_guard trigger. A new tenant table without them
// fails here; attach them in its migration.

describe("tenant tables", () => {
  it("all have row level security and the lock guard", async () => {
    const { data, error } = await createAdminClient().rpc("tenant_table_gaps");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("the check is for the service role only", async () => {
    const admin = await signIn("admin", TEST_TENANTS.a.slug);
    const { error } = await admin.rpc("tenant_table_gaps");
    expect(error?.code).toBe("42501");
  });
});
