import { describe, expect, it } from "vitest";
import { customRolePermissionKeys, roleSchema } from "./schemas";

const all = [
  { key: "machines.read", module: "core" },
  { key: "orders.manage", module: "production" },
  { key: "users.read", module: "core" },
  { key: "users.manage", module: "core" },
  { key: "roles.manage", module: "core" },
  { key: "audit.read", module: "core" },
  { key: "platform.manage", module: "platform" },
  { key: "platform.read", module: "platform" },
  { key: "platform.lock", module: "platform" },
  { key: "platform.organizations.delete", module: "platform" },
];

describe("customRolePermissionKeys", () => {
  it("refuses platform permissions outside the platform organization and the delete permission everywhere", () => {
    const tenant = customRolePermissionKeys(false, all);
    expect(tenant).toEqual([
      "machines.read",
      "orders.manage",
      "users.read",
      "users.manage",
      "roles.manage",
      "audit.read",
    ]);
    const zcore = customRolePermissionKeys(true, all);
    expect(zcore).toEqual([
      "users.read",
      "users.manage",
      "roles.manage",
      "audit.read",
      "platform.read",
      "platform.lock",
    ]);
    expect(zcore).not.toContain("platform.organizations.delete");
    expect(zcore).not.toContain("platform.manage");
    expect(tenant).not.toContain("platform.manage");
  });

  it("offers the Zcore organization no production permissions", () => {
    const zcore = customRolePermissionKeys(true, all);
    expect(zcore).not.toContain("machines.read");
    expect(zcore).not.toContain("orders.manage");
  });
});

describe("roleSchema", () => {
  it("never accepts platform.manage or platform.organizations.delete", () => {
    expect(roleSchema.safeParse({ name: "A", permissions: ["platform.read"] }).success).toBe(true);
    expect(roleSchema.safeParse({ name: "A", permissions: ["platform.manage"] }).success).toBe(
      false,
    );
    expect(
      roleSchema.safeParse({ name: "A", permissions: ["platform.organizations.delete"] }).success,
    ).toBe(false);
  });
});
