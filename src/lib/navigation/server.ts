import "server-only";
import { getTranslations } from "next-intl/server";
import { getMemberAccess } from "@/lib/auth/access";
import type { CurrentMember } from "@/lib/auth/session";
import { buildNavigation, type NavIconKey, type NavSurface } from "./registry";

// Serializable navigation for client components (labels already translated).
export type NavLink = { id: string; href: string; label: string; icon: NavIconKey };
export type NavGroup = { id: string; label: string; items: NavLink[] };

export async function getNavigation(
  member: CurrentMember,
  surface: NavSurface,
): Promise<NavGroup[]> {
  const [access, t] = await Promise.all([getMemberAccess(member), getTranslations("nav")]);
  return buildNavigation(surface, access).map(({ section, items }) => ({
    id: section,
    label: t(`sections.${section}`),
    items: items.map((item) => ({
      id: item.id,
      href: item.href,
      label: t(item.label),
      icon: item.icon,
    })),
  }));
}
