import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import { getOrderSettings } from "@/modules/production-orders/queries";
import { getProductionSettings } from "@/modules/products/queries";
import { OrderSettingsForm } from "./order-settings-form";
import { ProductionSettingsForm } from "./production-settings-form";

export default function ProductionSettingsPage() {
  return (
    <PageSuspense>
      <ProductionSettingsContent />
    </PageSuspense>
  );
}

async function ProductionSettingsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([
    getTranslations("productionSettings"),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("org.settings.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const [settings, orderSettings] = await Promise.all([
    getProductionSettings(member.organization.id),
    getOrderSettings(member.organization.id),
  ]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ProductionSettingsForm
        cycleTimeUnit={settings.cycleTimeUnit}
        inspectionMode={settings.inspectionMode}
      />
      <OrderSettingsForm
        settings={orderSettings}
        today={zonedDate(new Date(), member.organization.timezone)}
      />
    </>
  );
}
