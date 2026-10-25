"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CutQuantitySheet } from "@/components/shared/cut-quantity-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setOrderStatusAction } from "@/modules/production-orders/actions";
import {
  allowedOrderTargets,
  MATERIAL_STATUSES,
  type OrderStatus,
} from "@/modules/production-orders/status-rules";

/**
 * Large buttons for the cutting worker / warehouse: waiting for material,
 * cutting, ready for further processing (with the number of cut pieces
 * while the cutting operation is open). The server decides who may.
 */
export function MaterialStatusButtons({
  orderId,
  orderNumber,
  status,
  cuttingOpen,
  quantity,
  wholePieces,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  cuttingOpen: boolean;
  quantity: string;
  wholePieces: boolean;
}) {
  const t = useTranslations("floorOrders.material");
  const tStatus = useTranslations("orderStatus");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cutting, setCutting] = useState(false);
  const allowed = allowedOrderTargets(status, { manage: false, material: true });

  const change = (to: OrderStatus) =>
    startTransition(async () => {
      const result = await setOrderStatusAction(orderId, { status: to, reason: "" });
      if (result.ok) {
        toast.success(
          t("changedToast", { number: orderNumber, status: t(`labels.${to}` as "labels.ready") }),
        );
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t("current", { status: tStatus(status) })}</p>
      <div role="group" aria-label={t("group")} className="grid gap-2">
        {MATERIAL_STATUSES.map((to) => {
          const current = to === status;
          return (
            <Button
              key={to}
              variant={current ? "default" : "outline"}
              aria-pressed={current}
              disabled={pending || current || !allowed.includes(to)}
              onClick={() => (to === "ready" && cuttingOpen ? setCutting(true) : change(to))}
              className={cn("h-12 text-base", current && "disabled:opacity-100")}
            >
              {t(`labels.${to}`)}
            </Button>
          );
        })}
      </div>
      <CutQuantitySheet
        open={cutting}
        onOpenChange={setCutting}
        orderId={orderId}
        orderNumber={orderNumber}
        suggested={quantity}
        wholePieces={wholePieces}
        side="bottom"
      />
    </div>
  );
}
