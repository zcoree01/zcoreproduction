import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import {
  getDeliverySettings,
  listDeliveryCustomers,
  listDeliveryTemplates,
  logoUrl,
} from "@/modules/finished-goods/queries";
import { DeliverySettingsView } from "./delivery-settings";

export default function DeliverySettingsPage() {
  return (
    <PageSuspense>
      <DeliverySettingsContent />
    </PageSuspense>
  );
}

async function DeliverySettingsContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([
    getTranslations("finishedGoods.settings"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("finished_goods")) return <ModuleDisabled />;
  if (!access.permissions.has("org.settings.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const [settings, templates, customers] = await Promise.all([
    getDeliverySettings(organizationId),
    listDeliveryTemplates(organizationId),
    listDeliveryCustomers(organizationId),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <DeliverySettingsView
        numbers={settings.numbers}
        logo={await logoUrl(settings.logoPath)}
        templates={templates.filter((tpl) => !tpl.archived)}
        customers={customers}
        today={zonedDate(new Date(), member.organization.timezone)}
      />
    </>
  );
}
