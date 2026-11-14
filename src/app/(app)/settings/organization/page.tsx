import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { timezoneLabel, timezoneOptions } from "@/modules/organizations/schemas";
import { TimezoneForm } from "./timezone-form";

export default function OrganizationSettingsPage() {
  return (
    <PageSuspense>
      <OrganizationSettingsContent />
    </PageSuspense>
  );
}

async function OrganizationSettingsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([
    getTranslations("organizationSettings"),
    getMemberAccess(member),
  ]);
  // Platform screens of the Zcore organization use the platform's zone.
  if (access.modules.has("platform")) {
    return <PermissionDenied description={t("notForPlatform")} />;
  }
  if (!access.permissions.has("org.settings.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const current = member.organization.timezone;
  const now = new Date();
  const options = timezoneOptions(current).map((zone) => ({
    value: zone,
    label: timezoneLabel(zone, now),
  }));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <TimezoneForm timezone={current} options={options} />
    </>
  );
}
