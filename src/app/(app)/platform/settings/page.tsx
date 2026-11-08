import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listBillingPackages } from "@/modules/platform/billing-queries";
import { getPlatformSettings, listModuleDependencies } from "@/modules/platform/queries";
import { BillingSettingsForm } from "./billing-settings-form";
import { PackagesCard } from "./packages-card";
import { TrialDaysForm } from "./trial-days-form";

export default function PlatformSettingsPage() {
  return (
    <PageSuspense>
      <PlatformSettingsContent />
    </PageSuspense>
  );
}

async function PlatformSettingsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("platform"), getMemberAccess(member)]);
  if (!access.modules.has("platform")) return <ModuleDisabled />;
  if (!access.permissions.has("platform.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const [settings, packages, dependencies] = await Promise.all([
    getPlatformSettings(),
    listBillingPackages(),
    listModuleDependencies(),
  ]);
  return (
    <>
      <PageHeader title={t("settingsTitle")} description={t("settingsDescription")} />
      <PackagesCard packages={packages} dependencies={dependencies} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BillingSettingsForm
          graceDays={settings.paymentGraceDays}
          warningDays={settings.lockWarningDays}
          contact={settings.lockContact}
        />
        <TrialDaysForm initial={settings.defaultTrialDays} />
      </div>
    </>
  );
}
