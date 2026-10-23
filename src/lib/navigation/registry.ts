import type { PermissionKey } from "@/lib/auth/permissions";

// Single source of truth for navigation. Only real, implemented routes belong
// here: an item appears when its module is enabled for the organization
// (org_modules) and the member holds its permission. Hiding is UX only; every
// page and action enforces access on the server.

export type NavSurface = "app" | "floor";
export type NavSectionKey = "overview" | "administration" | "work";
export type NavLabelKey = "dashboard" | "users" | "floorHome";
export type NavIconKey = "dashboard" | "users" | "home";

export type NavItemDef = {
  id: string;
  href: string;
  label: NavLabelKey;
  icon: NavIconKey;
  /** modules.key that must be enabled in org_modules. */
  module: string;
  permission?: PermissionKey;
  surface: NavSurface;
  section: NavSectionKey;
};

export const NAV_SECTIONS: Record<NavSurface, readonly NavSectionKey[]> = {
  app: ["overview", "administration"],
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
    id: "floor-home",
    href: "/floor",
    label: "floorHome",
    icon: "home",
    module: "core",
    surface: "floor",
    section: "work",
  },
];

export type NavAccess = {
  modules: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
};

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
      (!item.permission || access.permissions.has(item.permission)),
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
