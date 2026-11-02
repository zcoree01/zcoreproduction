"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDecimal } from "@/lib/decimal";
import { recordExternalResultAction } from "@/modules/planning/actions";
import type { OrderOperation } from "@/modules/production-orders/queries";

/**
 * Days and price of an external operation (hardening, coating…), entered
 * once the pieces are back (D-041). Not counted as our production time.
 */
export function ExternalResult({ op, canManage }: { op: OrderOperation; canManage: boolean }) {
  const t = useTranslations("planning.external");
  const [open, setOpen] = useState(false);
  const recorded = op.externalDays !== null || op.externalCost !== null;
  if (op.status !== "done") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {recorded ? (
        <span className="tabular-nums" data-testid={`external-result-${op.type.code}`}>
          {[
            op.externalDays !== null ? t("summary", { days: op.externalDays }) : null,
            op.externalCost !== null
              ? t("costSummary", { cost: formatDecimal(op.externalCost) })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}
      {canManage ? (
        <Button variant="link" size="xs" className="h-auto p-0" onClick={() => setOpen(true)}>
          {t("button")}
        </Button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
          {open ? (
            <ExternalResultForm op={op} onDone={() => setOpen(false)} />
          ) : (
            <SheetHeader>
              <SheetTitle>{t("title")}</SheetTitle>
            </SheetHeader>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ExternalResultForm({ op, onDone }: { op: OrderOperation; onDone: () => void }) {
  const t = useTranslations("planning");
  // Time between shipping and receipt, in whole days, as the suggestion.
  const measured = Math.max(0, Math.ceil(Number(op.runSeconds) / 86_400));
  const [days, setDays] = useState(String(op.externalDays ?? (measured || "")));
  const [cost, setCost] = useState(op.externalCost ? formatDecimal(op.externalCost) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await recordExternalResultAction({
        operationId: op.id,
        days: days.trim() === "" ? null : Number(days),
        cost: cost.replace(/\s/g, ""),
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("external.saved"));
      onDone();
    });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("external.title")}</SheetTitle>
        <SheetDescription>
          {op.type.code} {op.externalCompany ?? op.type.name} · {t("external.description")}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="external-days">{t("external.days")}</FieldLabel>
            <Input
              id="external-days"
              type="number"
              min={0}
              max={3650}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
            {measured > 0 ? (
              <FieldDescription>{t("external.daysHint", { days: measured })}</FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="external-cost">{t("external.cost")}</FieldLabel>
            <Input
              id="external-cost"
              inputMode="decimal"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button onClick={save} disabled={pending}>
          {t("external.save")}
        </Button>
      </SheetFooter>
    </>
  );
}
