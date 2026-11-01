import { QrCodeIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { cn } from "@/lib/utils";
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
      <PageHeader
        title={t("locations.title")}
        description={t("locations.description")}
        actions={
          <Link
            href="/inventory/labels"
            target="_blank"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <QrCodeIcon />
            {t("labelsButton")}
          </Link>
        }
      />
      <LocationList locations={locations} machines={machines} />
    </>
  );
}
