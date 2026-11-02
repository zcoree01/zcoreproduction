import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listStockLocations } from "@/modules/inventory/queries";
import { listMachineOptions } from "@/modules/machines/queries";
import { listTools } from "@/modules/tools/queries";
import { ToolList } from "./tool-list";

export default function ToolsPage() {
  return (
    <PageSuspense>
      <ToolsContent />
    </PageSuspense>
  );
}

async function ToolsContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("tools"), getMemberAccess(member)]);
  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("tools.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const canManage = access.permissions.has("tools.manage");
  const [tools, locations, machines] = await Promise.all([
    listTools(organizationId),
    canManage ? listStockLocations(organizationId) : Promise.resolve([]),
    canManage && access.permissions.has("machines.read")
      ? listMachineOptions(organizationId)
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ToolList
        tools={tools}
        locations={locations.filter((l) => !l.archived)}
        machines={machines}
        canManage={canManage}
      />
    </>
  );
}
