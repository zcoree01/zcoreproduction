import type { PermissionKey } from "@/lib/auth/permissions";

// Single source of truth for navigation. Only real, implemented routes belong
// here: an item appears when its module is enabled for the organization
// (org_modules) and the member holds its permission. Hiding is UX only; every
// page and action enforces access on the server.

export type NavSurface = "app" | "floor";
export type NavSectionKey = "overview" | "production" | "administration" | "platform" | "work";
export type NavLabelKey =
  | "dashboard"
  | "users"
  | "floorHome"
  | "machines"
  | "employees"
  | "products"
  | "customers"
  | "materials"
  | "catalogs"
  | "operationTypes"
  | "productionSettings"
  | "floorMachines"
  | "orders"
  | "floorOperations"
  | "inspections"
  | "productionDay"
  | "attendance"
  | "shiftSettings"
  | "floorAttendance"
  | "schedule"
  | "crews"
  | "absences"
  | "companySettings"
  | "supportSettings"
  | "platformOrganizations"
  | "platformRequests"
  | "platformSettings"
  | "monthly"
  | "holidays";
export type NavIconKey =
  | "dashboard"
  | "users"
  | "home"
  | "machine"
  | "employee"
  | "product"
  | "customer"
  | "material"
  | "catalog"
  | "operation"
  | "settings"
  | "order"
  | "clock"
  | "calendar"
  | "building"
  | "inbox"
  | "shield";

export type NavItemDef = {
  id: string;
  href: string;
  label: NavLabelKey;
  icon: NavIconKey;
  /** modules.key that must be enabled in org_modules. */
  module: string;
  /** Required permission; with a list, any one of them is enough. */
  permission?: PermissionKey | readonly PermissionKey[];
  surface: NavSurface;
  section: NavSectionKey;
};

export const NAV_SECTIONS: Record<NavSurface, readonly NavSectionKey[]> = {
  app: ["overview", "production", "administration", "platform"],
  floor: ["work"],
};

export const NAV_ITEMS: readonly NavItemDef[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "dashboard",
    icon: "dashboard",
    module: "core",
    surface: "app",
    section: "overview",
  },
  {
    id: "machines",
    href: "/machines",
    label: "machines",
    icon: "machine",
    module: "production",
    permission: "machines.read",
    surface: "app",
    section: "production",
  },
  {
    id: "employees",
    href: "/employees",
    label: "employees",
    icon: "employee",
    module: "production",
    permission: "employees.read",
    surface: "app",
    section: "production",
  },
  {
    id: "orders",
    href: "/orders",
    label: "orders",
    icon: "order",
    module: "production",
    permission: "orders.read",
    surface: "app",
    section: "production",
  },
  {
    id: "production-day",
    href: "/production",
    label: "productionDay",
    icon: "dashboard",
    module: "production",
    permission: "orders.read",
    surface: "app",
    section: "production",
  },
  {
    id: "attendance",
    href: "/attendance",
    label: "attendance",
    icon: "clock",
    module: "attendance",
    permission: "attendance.read",
    surface: "app",
    section: "production",
  },
  {
    id: "schedule",
    href: "/attendance/schedule",
    label: "schedule",
    icon: "calendar",
    module: "attendance",
    permission: "attendance.read",
    surface: "app",
    section: "production",
  },
  {
    id: "crews",
    href: "/attendance/crews",
    label: "crews",
    icon: "users",
    module: "attendance",
    permission: "attendance.read",
    surface: "app",
    section: "production",
  },
  {
    id: "absences",
    href: "/attendance/requests",
    label: "absences",
    icon: "calendar",
    module: "attendance",
    permission: ["absences.read", "attendance.manage"],
    surface: "app",
    section: "production",
  },
  {
    id: "monthly",
    href: "/attendance/monthly",
    label: "monthly",
    icon: "dashboard",
    module: "attendance",
    permission: "attendance.read",
    surface: "app",
    section: "production",
  },
  {
    id: "products",
    href: "/products",
    label: "products",
    icon: "product",
    module: "production",
    permission: "products.read",
    surface: "app",
    section: "production",
  },
  {
    id: "customers",
    href: "/customers",
    label: "customers",
    icon: "customer",
    module: "production",
    permission: "customers.read",
    surface: "app",
    section: "production",
  },
  {
    id: "users",
    href: "/admin/users",
    label: "users",
    icon: "users",
    module: "core",
    permission: "users.read",
    surface: "app",
    section: "administration",
  },
  {
    id: "company-settings",
    href: "/settings/company",
    label: "companySettings",
    icon: "building",
    module: "core",
    permission: "org.settings.manage",
    surface: "app",
    section: "administration",
  },
  {
    id: "support-settings",
    href: "/settings/support",
    label: "supportSettings",
    icon: "shield",
    module: "core",
    permission: "support.approve",
    surface: "app",
    section: "administration",
  },
  {
    id: "platform-organizations",
    href: "/platform",
    label: "platformOrganizations",
    icon: "shield",
    module: "platform",
    permission: "platform.manage",
    surface: "app",
    section: "platform",
  },
  {
    id: "platform-requests",
    href: "/platform/requests",
    label: "platformRequests",
    icon: "inbox",
    module: "platform",
    permission: "platform.manage",
    surface: "app",
    section: "platform",
  },
  {
    id: "platform-settings",
    href: "/platform/settings",
    label: "platformSettings",
    icon: "settings",
    module: "platform",
    permission: "platform.manage",
    surface: "app",
    section: "platform",
  },
  {
    id: "catalogs",
    href: "/settings/catalogs",
    label: "catalogs",
    icon: "catalog",
    module: "production",
    permission: ["machines.manage", "employees.manage", "products.manage", "orders.manage"],
    surface: "app",
    section: "administration",
  },
  {
    id: "operation-types",
    href: "/settings/operation-types",
    label: "operationTypes",
    icon: "operation",
    module: "production",
    permission: "products.manage",
    surface: "app",
    section: "administration",
  },
  {
    id: "materials",
    href: "/settings/materials",
    label: "materials",
    icon: "material",
    module: "production",
    permission: "products.manage",
    surface: "app",
    section: "administration",
  },
  {
    id: "production-settings",
    href: "/settings/production",
    label: "productionSettings",
    icon: "settings",
    module: "production",
    permission: "org.settings.manage",
    surface: "app",
    section: "administration",
  },
  {
    id: "shift-settings",
    href: "/settings/shifts",
    label: "shiftSettings",
    icon: "clock",
    module: "attendance",
    permission: ["shifts.manage", "payroll.manage"],
    surface: "app",
    section: "administration",
  },
  {
    id: "holidays",
    href: "/settings/holidays",
    label: "holidays",
    icon: "calendar",
    module: "attendance",
    permission: "shifts.manage",
    surface: "app",
    section: "administration",
  },
  {
    id: "inspections",
    href: "/floor/operations?machine=mine",
    label: "inspections",
    icon: "operation",
    module: "production",
    permission: "quality.inspect",
    surface: "app",
    section: "production",
  },
  {
    id: "floor-home",
    href: "/floor",
    label: "floorHome",
    icon: "home",
    module: "core",
    surface: "floor",
    section: "work",
  },
  {
    id: "floor-attendance",
    href: "/floor/attendance",
    label: "floorAttendance",
    icon: "clock",
    module: "attendance",
    surface: "floor",
    section: "work",
  },
  {
    id: "floor-operations",
    href: "/floor/operations",
    label: "floorOperations",
    icon: "order",
    module: "production",
    permission: ["machines.status.update", "quality.inspect"],
    surface: "floor",
    section: "work",
  },
  {
    id: "floor-machines",
    href: "/floor/machines",
    label: "floorMachines",
    icon: "machine",
    module: "production",
    permission: "machines.status.update",
    surface: "floor",
    section: "work",
  },
];

export type NavAccess = {
  modules: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
};

function hasAnyPermission(
  granted: ReadonlySet<string>,
  required: NavItemDef["permission"],
): boolean {
  if (!required) return true;
  const options: readonly PermissionKey[] = typeof required === "string" ? [required] : required;
  return options.some((permission) => granted.has(permission));
}

export type NavSection = { section: NavSectionKey; items: NavItemDef[] };

export function buildNavigation(
  surface: NavSurface,
  access: NavAccess,
  items: readonly NavItemDef[] = NAV_ITEMS,
): NavSection[] {
  const visible = items.filter(
    (item) =>
      item.surface === surface &&
      access.modules.has(item.module) &&
      hasAnyPermission(access.permissions, item.permission),
  );
  return NAV_SECTIONS[surface]
    .map((section) => ({ section, items: visible.filter((item) => item.section === section) }))
    .filter((group) => group.items.length > 0);
}

/** The nav item a pathname belongs to (longest matching href). */
export function activeNavItem<T extends { href: string }>(items: readonly T[], pathname: string) {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
