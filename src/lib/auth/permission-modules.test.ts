import { describe, expect, it } from "vitest";
import { effectivePermissions } from "./permission-modules";

describe("effectivePermissions", () => {
  it("keeps only permissions whose module is enabled (D-049)", () => {
    const rows = [
      { permission_key: "orders.read", module_key: "production" },
      { permission_key: "tools.read", module_key: "tools" },
      { permission_key: "users.read", module_key: "core" },
    ];
    expect(effectivePermissions(rows, new Set(["core", "production"]))).toEqual(
      new Set(["orders.read", "users.read"]),
    );
  });

  it("drops a permission without a known module", () => {
    expect(
      effectivePermissions([{ permission_key: "x.read", module_key: null }], new Set(["core"])),
    ).toEqual(new Set());
  });
});
