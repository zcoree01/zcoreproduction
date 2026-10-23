import { describe, expect, it, vi } from "vitest";
import { createOrgUser, type CreateUserDeps } from "./create-user";
import { createUserSchema } from "./schemas";

const ORG = { id: "11111111-1111-4111-8111-111111111111", slug: "demo" };
const ROLE_ID = "33333333-3333-4333-8333-333333333333";
const INPUT = {
  username: "novi.radnik",
  fullName: "Novi Radnik",
  roleId: ROLE_ID,
  password: "Pocetna-123",
};

function deps(overrides: Partial<CreateUserDeps> = {}) {
  const value = {
    findRole: vi.fn<CreateUserDeps["findRole"]>(async () => ({ key: "operator" })),
    createAuthUser: vi.fn<CreateUserDeps["createAuthUser"]>(async () => ({
      ok: true as const,
      userId: "user-1",
    })),
    audit: vi.fn<CreateUserDeps["audit"]>(async () => undefined),
    ...overrides,
  };
  return value;
}

describe("createOrgUser", () => {
  it("creates the auth user with the synthetic e-mail and the role key", async () => {
    const d = deps();
    await expect(createOrgUser(d, ORG, INPUT)).resolves.toEqual({ ok: true, userId: "user-1" });
    expect(d.createAuthUser).toHaveBeenCalledWith({
      email: "novi.radnik@demo.users.zcore.ba",
      password: "Pocetna-123",
      appMetadata: { organization_id: ORG.id, username: "novi.radnik", role: "operator" },
      fullName: "Novi Radnik",
    });
  });

  it("writes an audit entry without the password", async () => {
    const d = deps();
    await createOrgUser(d, ORG, INPUT);
    expect(d.audit).toHaveBeenCalledWith({
      action: "users.create",
      entityId: "user-1",
      after: { username: "novi.radnik", full_name: "Novi Radnik", role: "operator" },
    });
    expect(JSON.stringify(vi.mocked(d.audit).mock.calls)).not.toContain("Pocetna-123");
  });

  it("refuses a role that is not visible in the organization", async () => {
    const d = deps({ findRole: vi.fn(async () => null) });
    await expect(createOrgUser(d, ORG, INPUT)).resolves.toEqual({
      ok: false,
      error: "role_not_found",
    });
    expect(d.createAuthUser).not.toHaveBeenCalled();
  });

  it("maps an existing e-mail to username_taken and does not audit", async () => {
    const d = deps({
      createAuthUser: vi.fn(async () => ({
        ok: false as const,
        code: "email_exists",
        message: "exists",
      })),
    });
    await expect(createOrgUser(d, ORG, INPUT)).resolves.toEqual({
      ok: false,
      error: "username_taken",
    });
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("surfaces unexpected Auth errors", async () => {
    const d = deps({
      createAuthUser: vi.fn(async () => ({
        ok: false as const,
        code: "unexpected_failure",
        message: "boom",
      })),
    });
    await expect(createOrgUser(d, ORG, INPUT)).rejects.toThrow("boom");
  });
});

describe("createUserSchema", () => {
  it("normalises the username and trims the name", () => {
    expect(
      createUserSchema.parse({ ...INPUT, username: " Novi.Radnik ", fullName: " Ana " }),
    ).toMatchObject({ username: "novi.radnik", fullName: "Ana" });
  });

  it("requires an 8+ character password and a uuid role", () => {
    const result = createUserSchema.safeParse({ ...INPUT, password: "short", roleId: "admin" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(["password", "roleId"]);
  });
});
