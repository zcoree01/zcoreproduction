import { ArrowLeftIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import { getStockCount, listStockItemOptions } from "@/modules/inventory/queries";
import { CountEntry } from "@/app/(app)/inventory/counts/count-entry";
import { warehouseAccess } from "../../guard";

export default function WarehouseCountPage({ params }: PageProps<"/floor/warehouse/counts/[id]">) {
  return (
    <PageSuspense>
      <WarehouseCountContent params={params} />
    </PageSuspense>
  );
}

async function WarehouseCountContent({ params }: { params: Promise<{ id: string }> }) {
  const guard = await warehouseAccess();
  if (!guard.ok) return guard.screen;
  const organizationId = guard.member.organization.id;
  const [t, tCounts] = await Promise.all([
    getTranslations("floorWarehouse.count"),
    getTranslations("inventory.counts"),
  ]);
  const { id } = await params;
  const countId = z.uuid().safeParse(id);
  const count = countId.success ? await getStockCount(organizationId, countId.data) : null;
  if (!count) return <EmptyState title={tCounts("notFoundTitle")} />;
  const items = count.status === "open" ? await listStockItemOptions(organizationId) : [];

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/floor/warehouse"
        className="inline-flex min-h-12 w-fit items-center gap-1 text-sm text-muted-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        {t("back")}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title", { number: count.number })}</h1>
        <p className="text-sm text-muted-foreground">
          {count.location} · {tCounts(`status.${count.status}`)}
        </p>
      </div>
      <CountEntry
        count={count}
        items={items}
        can={{
          move: true,
          approve: guard.access.permissions.has("inventory.adjust.approve"),
        }}
      />
    </div>
  );
}
