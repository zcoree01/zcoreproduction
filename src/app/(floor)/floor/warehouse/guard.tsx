import "server-only";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess, type MemberAccess } from "@/lib/auth/access";
import { requireMember, type CurrentMember } from "@/lib/auth/session";

/**
 * Mobile warehouse screens (D-033) need the inventory module and
 * inventory.move; returns the member and access, or the screen to show instead.
 */
export async function warehouseAccess(): Promise<
  { ok: true; member: CurrentMember; access: MemberAccess } | { ok: false; screen: ReactNode }
> {
  const member = await requireMember();
  const [t, access] = await Promise.all([
    getTranslations("floorWarehouse"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("inventory")) return { ok: false, screen: <ModuleDisabled /> };
  if (!access.permissions.has("inventory.move")) {
    return { ok: false, screen: <PermissionDenied description={t("deniedDescription")} /> };
  }
  return { ok: true, member, access };
}
