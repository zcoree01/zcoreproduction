"use client";

import { PrinterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import { formatDay } from "@/lib/format";
import { issueDeliveryNoteAction } from "@/modules/finished-goods/actions";
import type { DeliveryTemplate, FinishedStockRow } from "@/modules/finished-goods/queries";
import {
  DEFAULT_LAYOUT,
  previewDeliveryNumber,
  type DeliveryLineData,
  type DeliveryNumberSettings,
} from "@/modules/finished-goods/rules";
import { DeliveryNotePaper } from "../delivery-note-paper";

type Line = { include: boolean; quantity: string; position: string };

export type DeliveryCustomer = {
  id: string;
  name: string;
  number: number;
  templateId: string | null;
  address: string | null;
  city: string | null;
  taxId: string | null;
};

/**
 * New delivery note (D-034, D-039): the fields on the left, the note as it
 * will be printed on the right, updated while typing. Issuing assigns the
 * number; "Izdaj i štampaj" opens the print page (original + copy).
 */
export function DeliveryNoteForm({
  stock,
  customers,
  templates,
  initialCustomerId,
  today,
  organizationName,
  logoUrl,
  numbers,
}: {
  stock: FinishedStockRow[];
  customers: DeliveryCustomer[];
  templates: DeliveryTemplate[];
  initialCustomerId: string;
  today: string;
  organizationName: string;
  logoUrl: string | null;
  numbers: DeliveryNumberSettings;
}) {
  const t = useTranslations("finishedGoods.form");
  const tErrors = useTranslations("finishedGoods.errors");
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [customerId, setCustomerId] = useState(
    customers.some((c) => c.id === initialCustomerId)
      ? initialCustomerId
      : (customers[0]?.id ?? ""),
  );
  const customer = customers.find((c) => c.id === customerId);
  const [templateId, setTemplateId] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const orders = stock.filter((row) => row.customerId === customerId);

  const lineOf = (row: FinishedStockRow): Line =>
    lines[row.orderId] ?? {
      include: true,
      quantity: formatDecimal(row.onHand),
      position: row.customerPosition ?? "",
    };
  const update = (row: FinishedStockRow, patch: Partial<Line>) =>
    setLines((current) => ({ ...current, [row.orderId]: { ...lineOf(row), ...patch } }));
  const chosen = orders.filter((row) => lineOf(row).include);

  // The template the database will use: chosen, else the customer's, else the default.
  const template =
    templates.find((tpl) => tpl.id === templateId) ??
    templates.find((tpl) => tpl.id === customer?.templateId) ??
    templates.find((tpl) => tpl.isDefault);
  const previewLines: DeliveryLineData[] = chosen.map((row, index) => {
    const line = lineOf(row);
    return {
      lineNo: index + 1,
      customerPosition: line.position.trim() || null,
      orderNumber: row.orderNumber,
      partNumber: row.partNumber,
      drawingNumber: row.drawingNumber,
      revision: row.revision,
      productName: row.productName,
      quantity: parseDecimal(line.quantity, 3) ?? "0",
      unit: row.unit,
    };
  });
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(issuedOn);

  const issue = (print: boolean) => {
    setError(null);
    if (chosen.length === 0) {
      setError(t("noLines"));
      return;
    }
    startTransition(async () => {
      const result = await issueDeliveryNoteAction({
        idempotencyKey: key,
        customerId,
        templateId,
        issuedOn,
        notes,
        lines: chosen.map((row) => ({
          orderId: row.orderId,
          quantity: lineOf(row).quantity,
          customerPosition: lineOf(row).position,
        })),
      });
      if (result.ok) {
        toast.success(t("issued"));
        router.push(
          print
            ? `/inventory/delivery-notes/${result.id}/print?print=1`
            : `/inventory/delivery-notes/${result.id}`,
        );
      } else {
        setError(tErrors(result.error));
      }
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    issue(false);
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="note-customer">{t("customer")}</FieldLabel>
            <NativeSelect
              id="note-customer"
              className="w-full"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              {customers.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="note-template">{t("template")}</FieldLabel>
            <NativeSelect
              id="note-template"
              className="w-full"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <NativeSelectOption value="">
                {t("templateDefault")}
                {customer?.templateId
                  ? ` (${templates.find((tpl) => tpl.id === customer.templateId)?.name ?? ""})`
                  : ""}
              </NativeSelectOption>
              {templates.map((tpl) => (
                <NativeSelectOption key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="note-date">{t("issuedOn")}</FieldLabel>
            <Input
              id="note-date"
              type="date"
              value={issuedOn}
              onChange={(event) => setIssuedOn(event.target.value)}
            />
          </Field>
        </FieldGroup>

        <section className="flex flex-col gap-2">
          <h2 className="font-medium">{t("lines")}</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noStock")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {orders.map((row) => {
                const line = lineOf(row);
                return (
                  <li key={row.orderId} className="flex flex-col gap-2 rounded-lg border p-3">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={line.include}
                        aria-label={t("include", { order: row.orderNumber })}
                        onCheckedChange={(value) => update(row, { include: value === true })}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-mono font-medium">{row.orderNumber}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {row.partNumber} · {row.productName}
                        </span>
                      </span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <Field>
                        <FieldLabel htmlFor={`note-qty-${row.orderId}`}>
                          {t("quantity", { onHand: formatDecimal(row.onHand) })}
                        </FieldLabel>
                        <Input
                          id={`note-qty-${row.orderId}`}
                          inputMode="decimal"
                          value={line.quantity}
                          disabled={!line.include}
                          onChange={(event) => update(row, { quantity: event.target.value })}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`note-pos-${row.orderId}`}>{t("position")}</FieldLabel>
                        <Input
                          id={`note-pos-${row.orderId}`}
                          value={line.position}
                          disabled={!line.include}
                          onChange={(event) => update(row, { position: event.target.value })}
                        />
                      </Field>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Field>
          <FieldLabel htmlFor="note-notes">{t("notes")}</FieldLabel>
          <Textarea
            id="note-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={pending || orders.length === 0}>
            {t("submit")}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={pending || orders.length === 0}
            onClick={() => issue(true)}
          >
            <PrinterIcon />
            {t("submitPrint")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("numberHint")}</p>
      </form>

      <section className="flex flex-col gap-2 xl:sticky xl:top-4" aria-label={t("preview")}>
        <h2 className="font-medium">{t("preview")}</h2>
        <div className="overflow-x-auto rounded-lg border bg-muted p-3">
          <DeliveryNotePaper
            className="aspect-[210/297] min-w-[560px] shadow-md"
            organizationName={organizationName}
            logoUrl={template?.layout.show_logo ? logoUrl : null}
            layout={template?.layout ?? DEFAULT_LAYOUT}
            number={
              customer && validDate
                ? previewDeliveryNumber({
                    template: numbers.template,
                    customerNumber: customer.number,
                    date: issuedOn,
                  })
                : "…"
            }
            date={validDate ? formatDay(issuedOn) : ""}
            customer={{
              name: customer?.name ?? "",
              address: customer?.address ?? null,
              city: customer?.city ?? null,
              taxId: customer?.taxId ?? null,
            }}
            lines={previewLines}
            notes={notes.trim() || null}
          />
        </div>
      </section>
    </div>
  );
}
