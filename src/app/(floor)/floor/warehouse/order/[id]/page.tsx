import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import {
  getInventorySettings,
  getOrderMaterial,
  listStockLocations,
} from "@/modules/inventory/queries";
import { getOrder } from "@/modules/production-orders/queries";
import { warehouseAccess } from "../../guard";
import { OrderIssueScreen } from "./order-issue-screen";

export default function WarehouseOrderPage({ params }: PageProps<"/floor/warehouse/order/[id]">) {
  return (
    <PageSuspense>
      <WarehouseOrderContent params={params} />
    </PageSuspense>
  );
}

async function WarehouseOrderContent({ params }: { params: Promise<{ id: string }> }) {
  const guard = await warehouseAccess();
  if (!guard.ok) return guard.screen;
  const organizationId = guard.member.organization.id;
  const [t, format] = await Promise.all([getTranslations("floorWarehouse.order"), getFormatter()]);
  const { id } = await params;
  const orderId = z.uuid().safeParse(id);
  const order =
    orderId.success && guard.access.permissions.has("orders.read")
      ? await getOrder(organizationId, orderId.data)
      : null;
  if (!order || !order.customer) return <EmptyState title={t("notFound")} />;

  const [material, locations, settings] = await Promise.all([
    getOrderMaterial(organizationId, order.id, order.stockItemId, order.customer.id),
    listStockLocations(organizationId),
    getInventorySettings(organizationId),
  ]);

  return (
    <OrderIssueScreen
      order={{
        id: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customer.id,
        product: order.product ? `${order.product.partNumber} · ${order.product.name}` : "",
      }}
      material={{
        ...material,
        movementLabels: Object.fromEntries(
          material.movements.map((m) => [
            m.id,
            format.dateTime(new Date(m.createdAt), { dateStyle: "short", timeStyle: "short" }),
          ]),
        ),
      }}
      locations={locations}
      remnantMinLength={settings.remnantMinLengthMm}
    />
  );
}
