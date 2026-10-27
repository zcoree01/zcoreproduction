import { describe, expect, it, vi } from "vitest";
import { createOrgUser, type CreateUserDeps, type NewOrgUser } from "./create-user";
import { createUserSchema } from "./schemas";

const ORG = { id: "11111111-1111-4111-8111-111111111111", slug: "demo" };
const ROLE_ID = "33333333-3333-4333-8333-333333333333";
const INPUT: NewOrgUser = {
  username: "novi.radnik",
  fullName: "Novi Radnik",
  firstName: "Novi",
  lastName: "Radnik",
  roleId: ROLE_ID,
};
const GENERATED: NewOrgUser = {
  ...INPUT,
  username: null,
  fullName: "Mirza Zebić",
  firstName: "Mirza",
  lastName: "Zebić",
};

function deps(overrides: Partial<CreateUserDeps> = {}) {
  const value = {
    findRole: vi.fn<CreateUserDeps["findRole"]>(async () => ({ key: "operator" })),
    takenUsernames: vi.fn<CreateUserDeps["takenUsernames"]>(async () => new Set<string>()),
    generatePassword: vi.fn<CreateUserDeps["generatePassword"]>(() => "jabuka482"),
    createAuthUser: vi.fn<CreateUserDeps["createAuthUser"]>(async () => ({
      ok: true as const,
      userId: "user-1",
    })),
    audit: vi.fn<CreateUserDeps["audit"]>(async () => undefined),
    ...overrides,
  };
  return value;
}

const exists = { ok: false as const, code: "email_exists", message: "exists" };

describe("createOrgUser", () => {
  it("creates the auth user with a temporary password that must be changed", async () => {
    const d = deps();
    await expect(createOrgUser(d, ORG, INPUT)).resolves.toEqual({
      ok: true,
      userId: "user-1",
      username: "novi.radnik",
      password: "jabuka482",
    });
    expect(d.createAuthUser).toHaveBeenCalledWith({
      email: "novi.radnik@demo.users.zcore.ba",
      password: "jabuka482",
      appMetadata: {
        organization_id: ORG.id,
        username: "novi.radnik",
        role: "operator",
        must_change_password: true,
      },
      fullName: "Novi Radnik",
    });
    expect(d.takenUsernames).not.toHaveBeenCalled();
  });

  it("generates ime.p and takes more letters of the last name while taken", async () => {
    const d = deps({ takenUsernames: vi.fn(async () => new Set(["mirza.z", "mirza.ze"])) });
    await expect(createOrgUser(d, ORG, GENERATED)).resolves.toMatchObject({
      ok: true,
      username: "mirza.zeb",
    });
    expect(vi.mocked(d.takenUsernames).mock.calls[0]?.[0].slice(0, 3)).toEqual([
      "mirza.z",
      "mirza.ze",
      "mirza.zeb",
    ]);
  });

  it("moves to the next generated name when one is taken meanwhile", async () => {
    const createAuthUser = vi
      .fn<CreateUserDeps["createAuthUser"]>()
      .mockResolvedValueOnce(exists)
      .mockResolvedValueOnce({ ok: true, userId: "user-2" });
    const d = deps({ createAuthUser });
    await expect(createOrgUser(d, ORG, GENERATED)).resolves.toMatchObject({
      username: "mirza.ze",
      userId: "user-2",
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
    expect(JSON.stringify(vi.mocked(d.audit).mock.calls)).not.toContain("jabuka482");
  });

  it("refuses a role that is not visible in the organization", async () => {
    const d = deps({ findRole: vi.fn(async () => null) });
    await expect(createOrgUser(d, ORG, INPUT)).resolves.toEqual({
      ok: false,
      error: "role_not_found",
    });
    expect(d.createAuthUser).not.toHaveBeenCalled();
  });

  it("maps an existing chosen username to username_taken and does not audit", async () => {
    const d = deps({ createAuthUser: vi.fn(async () => exists) });
    await expect(createOrgUser(d, ORG, INPUT)).resolves.toEqual({
      ok: false,
      error: "username_taken",
    });
    expect(d.createAuthUser).toHaveBeenCalledTimes(1);
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
      createUserSchema.parse({ roleId: ROLE_ID, username: " Novi.Radnik ", fullName: " Ana " }),
    ).toMatchObject({ username: "novi.radnik", fullName: "Ana" });
  });

  it("treats an empty username as 'generate'", () => {
    expect(
      createUserSchema.parse({ roleId: ROLE_ID, username: "  ", fullName: "Ana Anić" }).username,
    ).toBeNull();
  });

  it("requires a valid username when given and a uuid role", () => {
    const result = createUserSchema.safeParse({ username: "a!", fullName: "A", roleId: "admin" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(["roleId", "username"]);
  });
});
