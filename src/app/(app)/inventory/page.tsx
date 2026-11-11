import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listStockItems, listStockLocations } from "@/modules/inventory/queries";
import { listMaterialOptions } from "@/modules/materials/queries";
import { StockTable } from "./stock-table";
import { canMoveStockFreely } from "@/modules/platform/lock-rules";

export default function InventoryPage() {
  return (
    <PageSuspense>
      <InventoryContent />
    </PageSuspense>
  );
}

async function InventoryContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("inventory"), getMemberAccess(member)]);

  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("inventory.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const canManage = access.permissions.has("inventory.items.manage");
  const [items, materials, locations] = await Promise.all([
    listStockItems(organizationId),
    canManage ? listMaterialOptions(organizationId) : Promise.resolve([]),
    canManage ? listStockLocations(organizationId) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title={t("list.title")} description={t("list.description")} />
      <StockTable
        items={items}
        materials={materials}
        locations={locations}
        canManage={canManage}
        canMove={canMoveStockFreely(access)}
      />
    </>
  );
}
