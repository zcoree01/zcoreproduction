import { HouseIcon, LayoutDashboardIcon, UsersIcon, type LucideIcon } from "lucide-react";
import type { NavIconKey } from "@/lib/navigation/registry";

// Icons are resolved on the client side of the boundary (components are not serializable).
const ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  users: UsersIcon,
  home: HouseIcon,
};

export function NavIcon({ icon, className }: { icon: NavIconKey; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden />;
}
