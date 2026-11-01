"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { QrScanner } from "@/components/shared/qr-scanner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { parseScan, scanTargetPath, type ScanTarget } from "@/modules/inventory/label-rules";

/**
 * Scans a warehouse label or an order QR and opens its screen. `onTarget`
 * handles the target in place instead (e.g. the lot on the order screen).
 */
export function ScanScreen({ onTarget }: { onTarget?: (target: ScanTarget) => boolean }) {
  const t = useTranslations("floorWarehouse.scanner");
  const router = useRouter();
  const [unknown, setUnknown] = useState(false);

  const handle = (code: string) => {
    const target = parseScan(code);
    if (!target) {
      setUnknown(true);
      return;
    }
    setUnknown(false);
    if (onTarget?.(target)) return;
    router.push(scanTargetPath(target));
  };

  return (
    <div className="flex flex-col gap-3">
      {unknown ? (
        <Alert variant="destructive">
          <AlertDescription>{t("unknown")}</AlertDescription>
        </Alert>
      ) : null}
      <QrScanner
        onCode={handle}
        labels={{
          hold: t("hold"),
          cameraFailed: t("cameraFailed"),
          unsupported: t("unsupported"),
          manual: t("manual"),
          open: t("open"),
        }}
      />
    </div>
  );
}
