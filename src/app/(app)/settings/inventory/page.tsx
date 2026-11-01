import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { getInventorySettings } from "@/modules/inventory/queries";
import { InventorySettingsForm } from "./inventory-settings-form";

export default function InventorySettingsPage() {
  return (
    <PageSuspense>
      <InventorySettingsContent />
    </PageSuspense>
  );
}

async function InventorySettingsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("inventory"), getMemberAccess(member)]);

  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("org.settings.manage")) {
    return <PermissionDenied description={t("settings.deniedDescription")} />;
  }

  const settings = await getInventorySettings(member.organization.id);
  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <InventorySettingsForm settings={settings} />
    </>
  );
}
