// Modules a package can contain (D-049). core is always on, platform is Zcore's
// own; neither is sold. The database keeps the same list in public.modules and
// the requirements in public.module_dependencies.

export const SELLABLE_MODULES = [
  "production",
  "planning",
  "reports",
  "inventory",
  "finished_goods",
  "tools",
  "attendance",
  "kiosk",
  "payroll",
] as const;

export type SellableModule = (typeof SELLABLE_MODULES)[number];
