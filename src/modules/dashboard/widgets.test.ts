import { describe, expect, it } from "vitest";
import {
  defaultLayout,
  layoutSchema,
  moveWidget,
  parseStoredLayout,
  visibleWidgets,
  WIDGET_KEYS,
} from "./widgets";

const access = (modules: string[], permissions: string[]) => ({
  modules: new Set(modules),
  permissions: new Set(permissions),
});

describe("dashboard widgets", () => {
  it("gives the admin every widget and the warehouse only inventory ones", () => {
    expect(defaultLayout("admin").map((widget) => widget.key)).toEqual(WIDGET_KEYS);
    expect(defaultLayout("warehouse").map((widget) => widget.key)).toContain("stock_below_minimum");
    expect(defaultLayout("warehouse").map((widget) => widget.key)).not.toContain("machines_now");
    expect(defaultLayout("custom_role")).toEqual([]);
  });

  it("shows only widgets of enabled modules the member has a permission for", () => {
    const layout = defaultLayout("admin");
    const shown = visibleWidgets(layout, access(["production"], ["orders.read"]));
    expect(shown.map((widget) => widget.key)).toContain("orders_due");
    expect(shown.map((widget) => widget.key)).not.toContain("close_requests");
    expect(shown.map((widget) => widget.key)).not.toContain("stock_below_minimum");
    // The permission alone is not enough without the module.
    expect(visibleWidgets(layout, access([], ["orders.read"]))).toEqual([]);
    // Any one of several permissions is enough.
    expect(
      visibleWidgets(
        [{ key: "attendance_requests", size: "normal" }],
        access(["attendance"], ["attendance.manage"]),
      ),
    ).toHaveLength(1);
  });

  it("validates layouts: known keys, sizes, no duplicates", () => {
    expect(layoutSchema.safeParse([{ key: "orders_due", size: "wide" }]).success).toBe(true);
    expect(layoutSchema.safeParse([{ key: "nope", size: "wide" }]).success).toBe(false);
    expect(layoutSchema.safeParse([{ key: "orders_due", size: "huge" }]).success).toBe(false);
    expect(
      layoutSchema.safeParse([
        { key: "orders_due", size: "wide" },
        { key: "orders_due", size: "normal" },
      ]).success,
    ).toBe(false);
  });

  it("drops unknown and repeated widgets of a stored layout", () => {
    expect(
      parseStoredLayout([
        { key: "orders_due", size: "wide" },
        { key: "removed_widget", size: "normal" },
        { key: "orders_due", size: "normal" },
        { key: "output_today", size: "giant" },
      ]),
    ).toEqual([
      { key: "orders_due", size: "wide" },
      { key: "output_today", size: "normal" },
    ]);
    expect(parseStoredLayout(null)).toEqual([]);
  });

  it("moves widgets within the list", () => {
    expect(moveWidget(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveWidget(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveWidget(["a", "b", "c"], 1, 9)).toEqual(["a", "c", "b"]);
    expect(moveWidget(["a", "b", "c"], 5, 0)).toEqual(["a", "b", "c"]);
  });
});
