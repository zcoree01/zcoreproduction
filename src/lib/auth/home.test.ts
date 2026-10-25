import { describe, expect, it } from "vitest";
import { canUseManagementApp, homePathFor } from "./home";
import { SYSTEM_ROLE_KEYS } from "./roles";

describe("homePathFor", () => {
  it("sends operators to the floor and every other system role to the app", () => {
    const homes = Object.fromEntries(SYSTEM_ROLE_KEYS.map((key) => [key, homePathFor(key)]));
    expect(homes).toEqual({
      admin: "/dashboard",
      director: "/dashboard",
      head_of_production: "/dashboard",
      warehouse: "/dashboard",
      operator: "/floor",
      quality_inspector: "/dashboard",
    });
  });

  it("treats custom roles as management users", () => {
    expect(homePathFor("maintenance")).toBe("/dashboard");
    expect(canUseManagementApp("maintenance")).toBe(true);
  });

  it("keeps operators out of the management app", () => {
    expect(canUseManagementApp("operator")).toBe(false);
  });
});
