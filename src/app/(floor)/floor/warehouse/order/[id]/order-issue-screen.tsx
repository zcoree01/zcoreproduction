"use client";

import { ArrowUpFromLineIcon, ScanLineIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { compareDecimals } from "@/lib/decimal";
import type { StockLocation } from "@/modules/inventory/queries";
import type { OrderMaterialView } from "@/app/(app)/orders/[id]/material-panel";
import { IssueSheet } from "@/app/(app)/orders/[id]/material-sheets";
import { useStockFormat } from "@/app/(app)/inventory/use-stock-format";
import { ScanScreen } from "../../scan/scan-screen";

/** Issue by scanning: the order is known, a scanned lot label preselects the material. */
export function OrderIssueScreen({
  order,
  material,
  locations,
  remnantMinLength,
}: {
  order: { id: string; orderNumber: string; customerId: string; product: string };
  material: OrderMaterialView;
  locations: StockLocation[];
  remnantMinLength: string;
}) {
  const t = useTranslations("floorWarehouse.order");
  const format = useStockFormat();
  const [scanning, setScanning] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [lotId, setLotId] = useState<string | undefined>(undefined);
  const item = material.item;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-mono text-2xl font-semibold">
          {t("title", { number: order.orderNumber })}
        </h1>
        <p>{order.product}</p>
        {item ? (
          <p className="text-lg font-medium">
            {item.code} · {item.name}
          </p>
        ) : null}
      </div>
      {!item ? (
        <p className="text-muted-foreground">{t("noItem")}</p>
      ) : (
        <>
          {material.reservation ? (
            <div className="flex flex-col gap-1 text-lg tabular-nums">
              <span>
                {t("remaining", {
                  quantity: format.quantity(item.baseUnit, material.reservation.remaining),
                })}
              </span>
              {compareDecimals(material.reservation.shortage, "0") > 0 ? (
                <span className="font-medium text-destructive">
                  {t("shortage", {
                    quantity: format.quantity(item.baseUnit, material.reservation.shortage),
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3">
            <Button size="lg" className="h-16 text-lg" onClick={() => setScanning((v) => !v)}>
              <ScanLineIcon />
              {t("scanLot")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-16 text-lg"
              onClick={() => {
                setLotId(undefined);
                setIssuing(true);
              }}
            >
              <ArrowUpFromLineIcon />
              {t("issue")}
            </Button>
          </div>
          {scanning ? (
            <ScanScreen
              onTarget={(target) => {
                if (target.kind !== "lot") return false;
                setLotId(target.lotId);
                setScanning(false);
                setIssuing(true);
                return true;
              }}
            />
          ) : null}
          <IssueSheet
            key={lotId ?? "any"}
            open={issuing}
            onClose={() => {
              setIssuing(false);
            }}
            order={order}
            material={material}
            locations={locations}
            remnantMinLength={remnantMinLength}
            initialLotId={lotId}
          />
        </>
      )}
    </div>
  );
}
