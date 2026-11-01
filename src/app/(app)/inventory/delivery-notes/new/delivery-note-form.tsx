"use client";

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
import { formatDecimal } from "@/lib/decimal";
import { issueDeliveryNoteAction } from "@/modules/finished-goods/actions";
import type { DeliveryTemplate, FinishedStockRow } from "@/modules/finished-goods/queries";

type Line = { include: boolean; quantity: string; position: string };

export function DeliveryNoteForm({
  stock,
  customers,
  templates,
  initialCustomerId,
  today,
}: {
  stock: FinishedStockRow[];
  customers: { id: string; name: string; templateId: string | null }[];
  templates: DeliveryTemplate[];
  initialCustomerId: string;
  today: string;
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const chosen = orders.filter((row) => lineOf(row).include);
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
        router.push(`/inventory/delivery-notes/${result.id}`);
      } else {
        setError(tErrors(result.error));
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-4xl flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup className="grid gap-4 md:grid-cols-3">
        <Field>
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
                <li
                  key={row.orderId}
                  className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
                >
                  <label className="flex min-w-56 flex-1 items-center gap-2">
                    <Checkbox
                      checked={line.include}
                      aria-label={t("include", { order: row.orderNumber })}
                      onCheckedChange={(value) => update(row, { include: value === true })}
                    />
                    <span className="flex flex-col">
                      <span className="font-mono font-medium">{row.orderNumber}</span>
                      <span className="text-sm text-muted-foreground">
                        {row.partNumber} · {row.productName}
                      </span>
                    </span>
                  </label>
                  <Field className="w-36">
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
                  <Field className="w-40">
                    <FieldLabel htmlFor={`note-pos-${row.orderId}`}>{t("position")}</FieldLabel>
                    <Input
                      id={`note-pos-${row.orderId}`}
                      value={line.position}
                      disabled={!line.include}
                      onChange={(event) => update(row, { position: event.target.value })}
                    />
                  </Field>
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
      <Button type="submit" size="lg" className="w-fit" disabled={pending || orders.length === 0}>
        {t("submit")}
      </Button>
    </form>
  );
}
