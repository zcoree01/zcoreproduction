import { getTranslations } from "next-intl/server";
import { getOrgFormatter } from "@/i18n/org-formatter";
import { z } from "zod";
import { PageSuspense } from "@/components/shared/page-suspense";
import {
  listStockCounts,
  listStockItemOptions,
  listStockLocations,
} from "@/modules/inventory/queries";
import { CountList } from "@/app/(app)/inventory/counts/count-list";
import { warehouseAccess } from "../guard";

export default function WarehouseCountsPage({
  searchParams,
}: PageProps<"/floor/warehouse/counts">) {
  return (
    <PageSuspense>
      <WarehouseCountsContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function WarehouseCountsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await warehouseAccess();
  if (!guard.ok) return guard.screen;
  const organizationId = guard.member.organization.id;
  const [t, format, params] = await Promise.all([
    getTranslations("inventory.counts"),
    getOrgFormatter(guard.member.organization.timezone),
    searchParams,
  ]);
  const [counts, locations, items] = await Promise.all([
    listStockCounts(organizationId),
    listStockLocations(organizationId),
    listStockItemOptions(organizationId),
  ]);
  const active = locations.filter((l) => !l.archived);
  const location = z.uuid().safeParse(params.location);
  const initialLocationId =
    location.success && active.some((l) => l.id === location.data) ? location.data : undefined;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CountList
        counts={counts
          .filter((c) => c.status === "open" || c.status === "submitted")
          .map((c) => ({
            ...c,
            createdLabel: format.dateTime(new Date(c.createdAt), {
              dateStyle: "short",
              timeStyle: "short",
            }),
          }))}
        locations={active}
        items={items}
        canOpen
        detailBase="/floor/warehouse/counts"
        initialLocationId={initialLocationId}
      />
    </div>
  );
}
