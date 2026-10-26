"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { parseDecimal } from "@/lib/decimal";
import { finishCuttingAction } from "@/modules/production-reporting/actions";
import type { WorkActionResult } from "@/modules/production-reporting/schemas";

/**
 * "Ready for further processing" while a cutting operation is open: the number
 * of cut pieces finishes the cutting operation and releases the order.
 */
export function CutQuantitySheet({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  suggested,
  wholePieces,
  side = "right",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  /** Ordered quantity, offered as the default. */
  suggested: string;
  wholePieces: boolean;
  side?: "right" | "bottom";
}) {
  const t = useTranslations("cutting");
  const router = useRouter();
  const [value, setValue] = useState(suggested.replace(".", ","));
  const [invalid, setInvalid] = useState(false);
  // One key per opened sheet: a double tap or a retry never reports twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const parsed = parseDecimal(value, 3);
    if (
      !parsed ||
      parsed === "0" ||
      parsed.startsWith("-") ||
      (wholePieces && parsed.includes("."))
    ) {
      setInvalid(true);
      return;
    }
    startTransition(async () => {
      let result: WorkActionResult;
      try {
        result = await finishCuttingAction(orderId, { quantity: parsed, idempotencyKey: key });
      } catch {
        // No connection: keep the number and the key, so sending again is safe.
        toast.error(t("errors.network"));
        return;
      }
      if (result.ok) {
        toast.success(t("doneToast", { number: orderNumber }));
        onOpenChange(false);
        setKey(crypto.randomUUID());
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("title", { number: orderNumber })}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <form
          id="cut-quantity-form"
          className="flex-1 overflow-y-auto p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="cut-quantity">{t("quantity")}</FieldLabel>
            <Input
              id="cut-quantity"
              inputMode="decimal"
              autoComplete="off"
              className="h-12 text-lg"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid || undefined}
            />
            {invalid ? (
              <FieldError>{wholePieces ? t("invalidWhole") : t("invalid")}</FieldError>
            ) : (
              <FieldDescription>{t("hint")}</FieldDescription>
            )}
          </Field>
        </form>
        <SheetFooter className="border-t">
          <Button
            type="submit"
            form="cut-quantity-form"
            className="h-12 text-base"
            disabled={pending}
          >
            {pending ? t("saving") : t("confirm")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
