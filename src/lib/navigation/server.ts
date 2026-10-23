import "server-only";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import type { CurrentMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildNavigation, type NavAccess, type NavIconKey, type NavSurface } from "./registry";

/**
 * Enabled modules and the member's permissions, read through RLS. Used only
 * to decide what to show; access itself is enforced by requirePermission/RLS.
 */
const getNavAccess = cache(async (member: CurrentMember): Promise<NavAccess> => {
  const supabase = await createClient();
  const [modules, permissions] = await Promise.all([
    supabase
      .from("org_modules")
      .select("module_key")
      .eq("organization_id", member.organization.id)
      .eq("enabled", true),
    member.role.archived
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("role_permissions")
          .select("permission_key")
          .eq("organization_id", member.organization.id)
          .eq("role_id", member.role.id),
  ]);
  if (modules.error) throw modules.error;
  if (permissions.error) throw permissions.error;

  return {
    modules: new Set(modules.data.map((row) => row.module_key)),
    permissions: new Set(permissions.data.map((row) => row.permission_key)),
  };
});

// Serializable navigation for client components (labels already translated).
export type NavLink = { id: string; href: string; label: string; icon: NavIconKey };
export type NavGroup = { id: string; label: string; items: NavLink[] };

export async function getNavigation(
  member: CurrentMember,
  surface: NavSurface,
): Promise<NavGroup[]> {
  const [access, t] = await Promise.all([getNavAccess(member), getTranslations("nav")]);
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
