import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import { getLot, getStockItemDetail, listStockLocations } from "@/modules/inventory/queries";
import { warehouseAccess } from "../../guard";
import { LotScreen } from "./lot-screen";
import { canMoveStockFreely } from "@/modules/platform/lock-rules";

export default function WarehouseLotPage({ params }: PageProps<"/floor/warehouse/lot/[id]">) {
  return (
    <PageSuspense>
      <WarehouseLotContent params={params} />
    </PageSuspense>
  );
}

async function WarehouseLotContent({ params }: { params: Promise<{ id: string }> }) {
  const guard = await warehouseAccess();
  if (!guard.ok) return guard.screen;
  const organizationId = guard.member.organization.id;
  const t = await getTranslations("floorWarehouse.lot");
  const { id } = await params;
  const lotId = z.uuid().safeParse(id);
  const lot = lotId.success ? await getLot(organizationId, lotId.data) : null;
  const detail = lot ? await getStockItemDetail(organizationId, lot.itemId) : null;
  if (!lot || !detail) return <EmptyState title={t("notFound")} />;

  const locations = await listStockLocations(organizationId);
  return (
    <LotScreen
      lot={lot}
      item={detail.item}
      balances={detail.balances.filter((b) => b.lotId === lot.lotId)}
      locations={locations}
      canTransfer={canMoveStockFreely(guard.access)}
    />
  );
}
