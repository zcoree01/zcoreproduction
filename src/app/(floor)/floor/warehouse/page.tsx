import { ClipboardListIcon, PackagePlusIcon, ScanLineIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageSuspense } from "@/components/shared/page-suspense";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listStockCounts } from "@/modules/inventory/queries";
import { warehouseAccess } from "./guard";
import { canMoveStockFreely } from "@/modules/platform/lock-rules";

export default function FloorWarehousePage() {
  return (
    <PageSuspense>
      <FloorWarehouseContent />
    </PageSuspense>
  );
}

const TILE = "h-20 justify-start gap-3 text-lg";

async function FloorWarehouseContent() {
  const guard = await warehouseAccess();
  if (!guard.ok) return guard.screen;
  const t = await getTranslations("floorWarehouse");
  const tCounts = await getTranslations("inventory.counts");
  const open = (await listStockCounts(guard.member.organization.id)).filter(
    (c) => c.status === "open",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="grid gap-3">
        <Link href="/floor/warehouse/scan" className={cn(buttonVariants({ size: "lg" }), TILE)}>
          <ScanLineIcon className="size-6" />
          {t("scan")}
        </Link>
        {/* Receipts and counts are refused while the firm is locked (D-059). */}
        {canMoveStockFreely(guard.access) ? (
          <>
            <Link
              href="/inventory/receipts/new"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }), TILE)}
            >
              <PackagePlusIcon className="size-6" />
              {t("receipt")}
            </Link>
            <Link
              href="/floor/warehouse/counts"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }), TILE)}
            >
              <ClipboardListIcon className="size-6" />
              {t("counts")}
            </Link>
          </>
        ) : null}
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t("openCounts")}</h2>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noOpenCounts")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/floor/warehouse/counts/${c.id}`}
                  className="flex min-h-12 items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <span>
                    <span className="font-mono">{c.number}</span> · {c.location}
                  </span>
                  <span className="text-sm tabular-nums">
                    {tCounts("progress", { counted: c.counted, lines: c.lines })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
