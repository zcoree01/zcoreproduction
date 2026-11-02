"use client";

import { PackageCheckIcon, TruckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { compareDecimals, formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { receiveFinishedAction } from "@/modules/finished-goods/actions";
import type { FinishedStock } from "@/modules/finished-goods/queries";
import { receivable } from "@/modules/finished-goods/rules";

/** Finished goods of the order: receive good pieces, start a delivery note (D-034). */
export function FinishedGoodsCard({
  orderId,
  customerId,
  goodQuantity,
  unitLabel,
  stock,
  canManage,
}: {
  orderId: string;
  customerId: string;
  goodQuantity: string;
  unitLabel: string;
  stock: FinishedStock;
  canManage: boolean;
}) {
  const t = useTranslations("finishedGoods.order");
  const tErrors = useTranslations("finishedGoods.errors");
  const open = receivable(goodQuantity, stock.received);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [quantity, setQuantity] = useState(formatDecimal(open));
  const [invalid, setInvalid] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = (value: string) => `${formatDecimal(value)} ${unitLabel}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setInvalid(null);
    startTransition(async () => {
      const result = await receiveFinishedAction({ idempotencyKey: key, orderId, quantity });
      if (result.ok) {
        toast.success(t("received_toast"));
        setKey(crypto.randomUUID());
      } else {
        setInvalid(tErrors(result.error));
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageCheckIcon className="size-4" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-6 text-sm">
          <span>
            {t("received")}: <strong className="tabular-nums">{amount(stock.received)}</strong>
          </span>
          <span>
            {t("shipped")}: <strong className="tabular-nums">{amount(stock.shipped)}</strong>
          </span>
          <span>
            {t("onHand")}: <strong className="tabular-nums">{amount(stock.onHand)}</strong>
          </span>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-end gap-3">
            {compareDecimals(open, "0") > 0 ? (
              <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
                <Field className="w-40" data-invalid={invalid ? true : undefined}>
                  <FieldLabel htmlFor="finished-quantity">{t("quantity")}</FieldLabel>
                  <Input
                    id="finished-quantity"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={pending}>
                  {t("receive")}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t("receivable", { quantity: amount(open) })}
                </span>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">{t("nothing")}</p>
            )}
            {compareDecimals(stock.onHand, "0") > 0 ? (
              <Link
                href={`/inventory/delivery-notes/new?customer=${customerId}`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <TruckIcon />
                {t("deliver")}
              </Link>
            ) : null}
          </div>
        ) : null}
        {invalid ? <FieldError>{invalid}</FieldError> : null}
      </CardContent>
    </Card>
  );
}
