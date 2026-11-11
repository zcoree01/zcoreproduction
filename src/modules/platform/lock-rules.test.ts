import { describe, expect, it } from "vitest";
import { canMoveStockFreely, lockedPermissions } from "./lock-rules";

describe("lockedPermissions (D-049)", () => {
  it("keeps read permissions and the work-in-progress ones", () => {
    const kept = lockedPermissions(
      new Set([
        "orders.read",
        "orders.manage",
        "products.manage",
        "users.manage",
        "inventory.move",
      ]),
    );
    expect(kept).toEqual(new Set(["orders.read", "orders.manage", "inventory.move"]));
  });

  it("drops everything that creates master data", () => {
    const kept = lockedPermissions(
      new Set([
        "customers.manage",
        "employees.manage",
        "machines.manage",
        "products.manage",
        "inventory.items.manage",
        "tools.manage",
        "roles.manage",
        "org.settings.manage",
        "payroll.manage",
      ]),
    );
    expect(kept).toEqual(new Set());
  });

  it("keeps finishing, shipping and support", () => {
    const keys = [
      "orders.material.update",
      "orders.close.approve",
      "quality.inspect",
      "machines.status.update",
      "finished_goods.manage",
      "support.approve",
    ];
    expect(lockedPermissions(new Set(keys))).toEqual(new Set(keys));
  });
});

describe("canMoveStockFreely (D-059)", () => {
  it("needs inventory.move and an unlocked organization", () => {
    const move = new Set(["inventory.move"]);
    expect(canMoveStockFreely({ permissions: move, locked: false })).toBe(true);
    // Locked: issuing to an order stays (inventory.move is kept), receipts,
    // transfers, corrections and counts are refused by lock_guard.
    expect(canMoveStockFreely({ permissions: move, locked: true })).toBe(false);
    expect(canMoveStockFreely({ permissions: new Set(), locked: false })).toBe(false);
  });
});
