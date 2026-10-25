import { describe, expect, it } from "vitest";
import {
  CATALOG_KINDS,
  CATALOG_MANAGE_PERMISSION,
  catalogItemNameSchema,
  manageableCatalogKinds,
} from "./schemas";

describe("catalog permissions", () => {
  it("machine, employee, product and order catalogs belong to their manage permission", () => {
    expect(CATALOG_MANAGE_PERMISSION).toEqual({
      machine_type: "machines.manage",
      location: "machines.manage",
      department: "employees.manage",
      job_title: "employees.manage",
      skill: "employees.manage",
      product_type: "products.manage",
      downtime_reason: "orders.manage",
      scrap_reason: "orders.manage",
    });
  });

  it("lists only manageable kinds, in display order", () => {
    expect(manageableCatalogKinds(new Set())).toEqual([]);
    expect(manageableCatalogKinds(new Set(["employees.manage"]))).toEqual([
      "department",
      "job_title",
      "skill",
    ]);
    expect(manageableCatalogKinds(new Set(["products.manage"]))).toEqual(["product_type"]);
    expect(manageableCatalogKinds(new Set(["orders.manage"]))).toEqual([
      "downtime_reason",
      "scrap_reason",
    ]);
    expect(
      manageableCatalogKinds(
        new Set(["machines.manage", "employees.manage", "products.manage", "orders.manage"]),
      ),
    ).toEqual([...CATALOG_KINDS]);
  });
});

describe("catalogItemNameSchema", () => {
  it("trims and requires a name of at most 100 characters", () => {
    expect(catalogItemNameSchema.parse({ name: "  CNC glodalica " })).toEqual({
      name: "CNC glodalica",
    });
    expect(catalogItemNameSchema.safeParse({ name: " " }).success).toBe(false);
    expect(catalogItemNameSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });
});
