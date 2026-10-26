import {
  BuildingIcon,
  ClipboardListIcon,
  ClockIcon,
  CogIcon,
  HardHatIcon,
  HouseIcon,
  LayersIcon,
  LayoutDashboardIcon,
  ListIcon,
  PackageIcon,
  SettingsIcon,
  UsersIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavIconKey } from "@/lib/navigation/registry";

// Icons are resolved on the client side of the boundary (components are not serializable).
const ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  users: UsersIcon,
  home: HouseIcon,
  machine: CogIcon,
  employee: HardHatIcon,
  product: PackageIcon,
  customer: BuildingIcon,
  material: LayersIcon,
  catalog: ListIcon,
  operation: WorkflowIcon,
  settings: SettingsIcon,
  order: ClipboardListIcon,
  clock: ClockIcon,
};

export function NavIcon({ icon, className }: { icon: NavIconKey; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden />;
}
