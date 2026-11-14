import { PackageXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getOrgFormatter } from "@/i18n/org-formatter";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import {
  getStockItemDetail,
  listItemReservations,
  listStockLocations,
} from "@/modules/inventory/queries";
import { listMaterialOptions } from "@/modules/materials/queries";
import { StockItemDetailView } from "./stock-item-detail";
import { canMoveStockFreely } from "@/modules/platform/lock-rules";

export default function StockItemPage({ params }: PageProps<"/inventory/[id]">) {
  return (
    <PageSuspense>
      <StockItemContent params={params} />
    </PageSuspense>
  );
}

async function StockItemContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, format, access] = await Promise.all([
    getTranslations("inventory"),
    getOrgFormatter(member.organization.timezone),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("inventory.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const { id } = await params;
  const itemId = z.uuid().safeParse(id);
  const detail = itemId.success ? await getStockItemDetail(organizationId, itemId.data) : null;
  if (!detail) {
    return (
      <EmptyState
        icon={<PackageXIcon />}
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundDescription")}
        action={
          <Link href="/inventory" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("detail.back")}
          </Link>
        }
      />
    );
  }

  const canManage = access.permissions.has("inventory.items.manage");
  const canMove = canMoveStockFreely(access);
  const canApprove = access.permissions.has("inventory.adjust.approve");
  const [materials, locations, reservations] = await Promise.all([
    canManage ? listMaterialOptions(organizationId) : Promise.resolve([]),
    listStockLocations(organizationId),
    listItemReservations(organizationId, detail.item.id),
  ]);

  // Dates are formatted here: server and browser ICU data differ (hydration).
  const labels = {
    movements: Object.fromEntries(
      detail.movements.map((m) => [
        m.id,
        format.dateTime(new Date(m.createdAt), { dateStyle: "short", timeStyle: "short" }),
      ]),
    ),
    lots: Object.fromEntries(
      detail.lots.map((lot) => [
        lot.id,
        format.dateTime(new Date(lot.receivedAt), { dateStyle: "medium" }),
      ]),
    ),
    reservations: Object.fromEntries(
      reservations.map((r) => [
        r.orderId,
        format.dateTime(new Date(`${r.dueDate}T12:00:00Z`), {
          dateStyle: "medium",
          timeZone: "UTC",
        }),
      ]),
    ),
  };

  return (
    <StockItemDetailView
      detail={detail}
      dateLabels={labels}
      reservations={reservations}
      materials={materials}
      locations={locations}
      permissions={{ canManage, canMove, canApprove }}
    />
  );
}
