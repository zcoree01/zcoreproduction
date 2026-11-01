"use client";

import { ArrowRightLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  LotView,
  StockBalanceRow,
  StockItemRow,
  StockLocation,
} from "@/modules/inventory/queries";
import { isDimensionedUnit } from "@/modules/inventory/rules";
import { TransferSheet } from "@/app/(app)/inventory/[id]/movement-sheets";
import { useStockFormat } from "@/app/(app)/inventory/use-stock-format";

export function LotScreen({
  lot,
  item,
  balances,
  locations,
}: {
  lot: LotView;
  item: StockItemRow;
  balances: StockBalanceRow[];
  locations: StockLocation[];
}) {
  const t = useTranslations("floorWarehouse.lot");
  const format = useStockFormat();
  const router = useRouter();
  const [moving, setMoving] = useState<StockBalanceRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title", { lot: lot.lotNumber })}</h1>
        <p className="text-lg">
          {item.code} · {item.name}
        </p>
        <p className="text-sm text-muted-foreground">
          {[lot.heatNumber ? t("heat", { heat: lot.heatNumber }) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {lot.ownerCustomer ? (
          <Badge variant="outline" className="w-fit">
            {t("customer", { name: lot.ownerCustomer })}
          </Badge>
        ) : null}
      </div>

      {balances.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {balances.map((b) => (
            <li
              key={`${b.locationId}:${b.length}:${b.width}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <span className="flex flex-col">
                <span className="text-lg font-medium tabular-nums">
                  {isDimensionedUnit(item.baseUnit)
                    ? format.pieces(b.pieces, b.length, b.width)
                    : format.quantity(item.baseUnit, b.quantity)}
                </span>
                <span className="text-sm text-muted-foreground">{b.location}</span>
              </span>
              <Button size="lg" variant="outline" onClick={() => setMoving(b)}>
                <ArrowRightLeftIcon />
                {t("transfer")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{t("issueHint")}</p>

      <TransferSheet
        item={item}
        balance={moving}
        locations={locations}
        onClose={() => {
          setMoving(null);
          router.refresh();
        }}
      />
    </div>
  );
}
