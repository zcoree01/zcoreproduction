import { describe, expect, it } from "vitest";
import { activeNavItem, buildNavigation, NAV_ITEMS, type NavItemDef } from "./registry";

const access = (modules: string[], permissions: string[] = []) => ({
  modules: new Set(modules),
  permissions: new Set(permissions),
});

const ids = (sections: ReturnType<typeof buildNavigation>) =>
  sections.map((s) => [s.section, s.items.map((i) => i.id)]);

describe("buildNavigation", () => {
  it("shows users only with users.read", () => {
    expect(ids(buildNavigation("app", access(["core"])))).toEqual([["overview", ["dashboard"]]]);
    expect(ids(buildNavigation("app", access(["core"], ["users.read"])))).toEqual([
      ["overview", ["dashboard"]],
      ["administration", ["users"]],
    ]);
  });

  it("hides everything of a module that is not enabled", () => {
    expect(buildNavigation("app", access([], ["users.read"]))).toEqual([]);
  });

  it("filters by surface", () => {
    expect(ids(buildNavigation("floor", access(["core"], ["users.read"])))).toEqual([
      ["work", ["floor-home"]],
    ]);
  });

  it("applies module and permission rules to future module items", () => {
    const items: NavItemDef[] = [
      ...NAV_ITEMS,
      {
        id: "orders",
        href: "/orders",
        label: "dashboard",
        icon: "dashboard",
        module: "production",
        permission: "users.read",
        surface: "app",
        section: "overview",
      },
    ];
    const withoutModule = buildNavigation("app", access(["core"], ["users.read"]), items);
    expect(withoutModule.flatMap((s) => s.items.map((i) => i.id))).not.toContain("orders");

    const withModule = buildNavigation(
      "app",
      access(["core", "production"], ["users.read"]),
      items,
    );
    expect(withModule.flatMap((s) => s.items.map((i) => i.id))).toContain("orders");
  });

  it("shows the production section only with the production module and read permissions", () => {
    const managers = ["users.read", "machines.read", "employees.read", "machines.manage"];
    expect(ids(buildNavigation("app", access(["core"], managers)))).toEqual([
      ["overview", ["dashboard"]],
      ["administration", ["users"]],
    ]);
    expect(ids(buildNavigation("app", access(["core", "production"], managers)))).toEqual([
      ["overview", ["dashboard"]],
      ["production", ["machines", "employees"]],
      ["administration", ["users", "catalogs"]],
    ]);
    // Warehouse: reads machines, manages no catalogs.
    expect(ids(buildNavigation("app", access(["core", "production"], ["machines.read"])))).toEqual([
      ["overview", ["dashboard"]],
      ["production", ["machines"]],
    ]);
  });

  it("accepts any one of several permissions", () => {
    const catalogs = (permissions: string[]) =>
      buildNavigation("app", access(["core", "production"], permissions))
        .flatMap((s) => s.items.map((i) => i.id))
        .includes("catalogs");
    expect(catalogs([])).toBe(false);
    expect(catalogs(["employees.manage"])).toBe(true);
    expect(catalogs(["machines.manage"])).toBe(true);
  });

  it("offers operators their machines on the floor", () => {
    expect(
      ids(buildNavigation("floor", access(["core", "production"], ["machines.status.update"]))),
    ).toEqual([["work", ["floor-home", "floor-machines"]]]);
  });

  it("only lists routes with unique ids and absolute hrefs", () => {
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) expect(item.href.startsWith("/")).toBe(true);
  });
});

describe("activeNavItem", () => {
  const items = [{ href: "/admin" }, { href: "/admin/users" }, { href: "/dashboard" }];

  it("matches exact and nested paths, preferring the longest href", () => {
    expect(activeNavItem(items, "/admin/users")?.href).toBe("/admin/users");
    expect(activeNavItem(items, "/admin/users/123")?.href).toBe("/admin/users");
    expect(activeNavItem(items, "/admin/settings")?.href).toBe("/admin");
  });

  it("does not match prefixes that are not path segments", () => {
    expect(activeNavItem(items, "/dashboards")).toBeUndefined();
  });
});
