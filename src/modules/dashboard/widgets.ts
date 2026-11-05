import { z } from "zod";
import type { PermissionKey } from "@/lib/auth/permissions";

// Dashboard widgets (D-037). The admin chooses an ordered list per role
// (dashboard_layouts); a member sees a widget only when the organization has
// its module and the member holds one of its permissions, so a layout never
// shows data its role may not read.

export const WIDGET_SIZES = ["normal", "wide"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export type WidgetGroup = "production" | "attendance" | "inventory";

type WidgetDefinition = {
  group: WidgetGroup;
  module: "production" | "attendance" | "inventory" | "tools" | "finished_goods";
  /** Any one of these is enough. */
  permissions: readonly PermissionKey[];
  size: WidgetSize;
};

export const WIDGETS = {
  orders_overview: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "normal",
  },
  output_today: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "normal",
  },
  orders_due: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "wide",
  },
  orders_in_progress: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "wide",
  },
  machines_now: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "wide",
  },
  output_trend: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "wide",
  },
  downtime_reasons: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "normal",
  },
  scrap_reasons: {
    group: "production",
    module: "production",
    permissions: ["orders.read"],
    size: "normal",
  },
  close_requests: {
    group: "production",
    module: "production",
    permissions: ["orders.close.approve"],
    size: "normal",
  },
  attendance_today: {
    group: "attendance",
    module: "attendance",
    permissions: ["attendance.read"],
    size: "normal",
  },
  attendance_requests: {
    group: "attendance",
    module: "attendance",
    permissions: ["absences.manage", "attendance.manage"],
    size: "normal",
  },
  stock_below_minimum: {
    group: "inventory",
    module: "inventory",
    permissions: ["inventory.read"],
    size: "normal",
  },
  material_shortages: {
    group: "inventory",
    module: "inventory",
    permissions: ["inventory.read"],
    size: "normal",
  },
  inventory_approvals: {
    group: "inventory",
    module: "inventory",
    permissions: ["inventory.read"],
    size: "normal",
  },
  tools_status: {
    group: "inventory",
    module: "tools",
    permissions: ["tools.read"],
    size: "normal",
  },
  finished_goods: {
    group: "inventory",
    module: "finished_goods",
    permissions: ["finished_goods.read"],
    size: "normal",
  },
  recent_delivery_notes: {
    group: "inventory",
    module: "finished_goods",
    permissions: ["finished_goods.read"],
    size: "normal",
  },
} as const satisfies Record<string, WidgetDefinition>;

export type WidgetKey = keyof typeof WIDGETS;

export const WIDGET_KEYS = Object.keys(WIDGETS) as WidgetKey[];

export type LayoutWidget = { key: WidgetKey; size: WidgetSize };

export const layoutSchema = z
  .array(
    z.object({
      key: z.enum(WIDGET_KEYS as [WidgetKey, ...WidgetKey[]]),
      size: z.enum(WIDGET_SIZES),
    }),
  )
  .max(40)
  .refine((list) => new Set(list.map((widget) => widget.key)).size === list.length, {
    message: "duplicate",
  });

/**
 * A stored layout as far as the app still knows its widgets: unknown keys
 * (a widget removed in a later version) and duplicates are dropped.
 */
export function parseStoredLayout(value: unknown): LayoutWidget[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: LayoutWidget[] = [];
  for (const item of value) {
    const parsed = z
      .object({ key: z.string(), size: z.enum(WIDGET_SIZES).catch("normal") })
      .safeParse(item);
    if (!parsed.success || !(parsed.data.key in WIDGETS) || seen.has(parsed.data.key)) continue;
    seen.add(parsed.data.key);
    result.push({ key: parsed.data.key as WidgetKey, size: parsed.data.size });
  }
  return result;
}

const all = (keys: readonly WidgetKey[]): LayoutWidget[] =>
  keys.map((key) => ({ key, size: WIDGETS[key].size }));

/** Layout of a role that has none saved, by the system role key. */
export function defaultLayout(roleKey: string): LayoutWidget[] {
  switch (roleKey) {
    case "admin":
    case "director":
      return all(WIDGET_KEYS);
    case "head_of_production":
      return all([
        "orders_overview",
        "output_today",
        "machines_now",
        "orders_due",
        "orders_in_progress",
        "close_requests",
        "downtime_reasons",
        "scrap_reasons",
        "output_trend",
        "material_shortages",
        "tools_status",
        "attendance_today",
      ]);
    case "warehouse":
      return all([
        "stock_below_minimum",
        "material_shortages",
        "inventory_approvals",
        "tools_status",
        "finished_goods",
        "recent_delivery_notes",
      ]);
    case "quality_inspector":
      return all(["output_today", "scrap_reasons", "orders_in_progress"]);
    case "hr":
      return all(["attendance_today", "attendance_requests"]);
    default:
      return [];
  }
}

export type WidgetAccess = {
  modules: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
};

export function widgetAllowed(key: WidgetKey, access: WidgetAccess): boolean {
  const widget: WidgetDefinition = WIDGETS[key];
  return (
    access.modules.has(widget.module) &&
    widget.permissions.some((permission) => access.permissions.has(permission))
  );
}

/** The widgets of a layout the member may see, in order. */
export function visibleWidgets(layout: LayoutWidget[], access: WidgetAccess): LayoutWidget[] {
  return layout.filter((widget) => widgetAllowed(widget.key, access));
}

/** Moves the widget at `from` to `to` (both clamped), returning a new list. */
export function moveWidget<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  if (from < 0 || from >= result.length) return result;
  const target = Math.max(0, Math.min(result.length - 1, to));
  const [item] = result.splice(from, 1);
  result.splice(target, 0, item as T);
  return result;
}
