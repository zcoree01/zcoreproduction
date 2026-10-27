import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { getPlatformSettings } from "@/modules/platform/queries";
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
  const settings = await getPlatformSettings();
  return (
    <>
      <PageHeader title={t("settingsTitle")} description={t("settingsDescription")} />
      <TrialDaysForm initial={settings.defaultTrialDays} />
    </>
  );
}
