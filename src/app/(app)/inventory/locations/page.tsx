import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listStockLocations } from "@/modules/inventory/queries";
import { listMachineOptions } from "@/modules/machines/queries";
import { LocationList } from "./location-list";

export default function LocationsPage() {
  return (
    <PageSuspense>
      <LocationsContent />
    </PageSuspense>
  );
}

async function LocationsContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("inventory"), getMemberAccess(member)]);

  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("inventory.items.manage")) {
    return <PermissionDenied description={t("locations.deniedDescription")} />;
  }

  const [locations, machines] = await Promise.all([
    listStockLocations(organizationId),
    access.permissions.has("machines.read")
      ? listMachineOptions(organizationId)
      : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t("locations.title")} description={t("locations.description")} />
      <LocationList locations={locations} machines={machines} />
    </>
  );
}
