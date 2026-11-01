import { ClipboardListIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import { buttonVariants } from "@/components/ui/button";
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { listLocationStock, listStockLocations } from "@/modules/inventory/queries";
import { displayUnit, isDimensionedUnit, toDisplayQuantity } from "@/modules/inventory/rules";
import { warehouseAccess } from "../../guard";

export default function WarehouseLocationPage({
  params,
}: PageProps<"/floor/warehouse/location/[id]">) {
  return (
    <PageSuspense>
      <WarehouseLocationContent params={params} />
    </PageSuspense>
  );
}

async function WarehouseLocationContent({ params }: { params: Promise<{ id: string }> }) {
  const guard = await warehouseAccess();
  if (!guard.ok) return guard.screen;
  const organizationId = guard.member.organization.id;
  const [t, tStock] = await Promise.all([
    getTranslations("floorWarehouse.location"),
    getTranslations("inventory"),
  ]);
  const { id } = await params;
  const locationId = z.uuid().safeParse(id);
  const location = locationId.success
    ? (await listStockLocations(organizationId)).find((l) => l.id === locationId.data)
    : undefined;
  if (!location) return <EmptyState title={t("notFound")} />;
  const stock = await listLocationStock(organizationId, location.id);

  const amount = (row: (typeof stock)[number]) => {
    if (isDimensionedUnit(row.baseUnit) && row.pieces !== null && row.length) {
      const size = row.width
        ? tStock("sheetSize", {
            length: formatDecimal(row.length),
            width: formatDecimal(row.width),
          })
        : tStock("barSize", { length: formatDecimal(row.length) });
      return tStock("piecesOf", { pieces: row.pieces, size });
    }
    return tStock("quantity", {
      value: formatDecimal(toDisplayQuantity(row.baseUnit, row.quantity)),
      unit: tStock(`displayUnits.${displayUnit(row.baseUnit)}`),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("title", { location: location.label })}</h1>
      <Link
        href={`/floor/warehouse/counts?location=${location.id}`}
        className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-14 w-fit")}
      >
        <ClipboardListIcon />
        {t("startCount")}
      </Link>
      {stock.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stock.map((row) => (
            <li key={`${row.lotId}:${row.locationId}:${row.length}:${row.width}`}>
              <Link
                href={`/floor/warehouse/lot/${row.lotId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {row.itemCode} · {row.itemName}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {[row.lotNumber, row.heatNumber, row.location].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-lg tabular-nums">{amount(row)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
