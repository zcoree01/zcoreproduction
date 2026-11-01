import { getTranslations } from "next-intl/server";
import { PageSuspense } from "@/components/shared/page-suspense";
import { warehouseAccess } from "../guard";
import { ScanScreen } from "./scan-screen";

export default function WarehouseScanPage() {
  return (
    <PageSuspense>
      <WarehouseScanContent />
    </PageSuspense>
  );
}

async function WarehouseScanContent() {
  const guard = await warehouseAccess();
  if (!guard.ok) return guard.screen;
  const t = await getTranslations("floorWarehouse.scanner");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <ScanScreen />
    </div>
  );
}
