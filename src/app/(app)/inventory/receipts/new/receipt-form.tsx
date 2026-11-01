"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { SearchSelect } from "@/components/shared/search-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addDecimals, divideDecimal, formatDecimal, parseDecimal } from "@/lib/decimal";
import type { CustomerOption } from "@/modules/customers/queries";
import { postReceiptAction } from "@/modules/inventory/actions";
import type { StockItem, StockLocation } from "@/modules/inventory/queries";
import {
  isDimensionedUnit,
  lineMass,
  lineQuantity,
  priceUnitsFor,
  receiptLineValue,
  type InventorySettings,
  type PriceUnit,
} from "@/modules/inventory/rules";
import { useStockFormat } from "../../use-stock-format";

type Line = {
  key: string;
  itemId: string;
  locationId: string;
  pieces: string;
  length: string;
  width: string;
  quantity: string;
  heatNumber: string;
  ownerCustomerId: string;
  unitPrice: string;
  priceUnit: PriceUnit | "";
  invoiceKg: string;
};

function emptyLine(): Line {
  return {
    key: crypto.randomUUID(),
    itemId: "",
    locationId: "",
    pieces: "",
    length: "",
    width: "",
    quantity: "",
    heatNumber: "",
    ownerCustomerId: "",
    unitPrice: "",
    priceUnit: "",
    invoiceKg: "",
  };
}

/** Line with the item's proposals (piece size, default location, price unit). */
function withItem(line: Line, item: StockItem | undefined): Line {
  if (!item) return { ...line, itemId: "" };
  const dimensioned = isDimensionedUnit(item.baseUnit);
  return {
    ...line,
    itemId: item.id,
    locationId: item.defaultLocationId ?? line.locationId,
    pieces: dimensioned ? line.pieces || "1" : "",
    length: dimensioned ? formatDecimal(item.standardLength) : "",
    width: item.baseUnit === "m2" ? formatDecimal(item.standardWidth) : "",
    quantity: dimensioned ? "" : line.quantity,
    priceUnit: priceUnitsFor(item.baseUnit)[0] ?? "",
  };
}

const decimal = (value: string) => parseDecimal(value, 4);

export function ReceiptForm({
  items,
  locations,
  customers,
  settings,
  today,
}: {
  items: StockItem[];
  locations: StockLocation[];
  customers: CustomerOption[];
  settings: InventorySettings;
  today: string;
}) {
  const t = useTranslations("inventory");
  const format = useStockFormat();
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [documentDate, setDocumentDate] = useState(today);
  const [supplier, setSupplier] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [notes, setNotes] = useState("");
  const [includesVat, setIncludesVat] = useState(settings.pricesIncludeVat);
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()]);
  const [failure, setFailure] = useState<{ error: string; fields: readonly string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const itemById = new Map(items.map((item) => [item.id, item]));

  const update = (index: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const preview = (line: Line) => {
    const item = itemById.get(line.itemId);
    if (!item) return null;
    const pieces = /^\d+$/.test(line.pieces) ? Number(line.pieces) : null;
    const quantity = lineQuantity(item.baseUnit, {
      pieces: isDimensionedUnit(item.baseUnit) ? pieces : null,
      length: isDimensionedUnit(item.baseUnit) ? decimal(line.length) : null,
      width: item.baseUnit === "m2" ? decimal(line.width) : null,
      quantity: isDimensionedUnit(item.baseUnit) ? null : decimal(line.quantity),
    });
    if (!quantity) return null;
    const mass = lineMass(quantity, item.kgPerUnit);
    const price = decimal(line.unitPrice);
    const value = line.ownerCustomerId
      ? "0"
      : price && line.priceUnit
        ? receiptLineValue({
            unit: item.baseUnit,
            quantity,
            pieces,
            mass,
            unitPrice: price,
            priceUnit: line.priceUnit,
            invoiceKg: decimal(line.invoiceKg),
            includesVat,
            vatRate: settings.vatRate,
          })
        : null;
    return { item, quantity, mass, value };
  };

  const previews = lines.map(preview);
  const total = addDecimals(
    previews.map((p) => p?.value ?? "0"),
    4,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const result = await postReceiptAction({
        idempotencyKey: key,
        documentDate,
        supplier,
        deliveryNote,
        notes,
        pricesIncludeVat: includesVat,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          locationId: line.locationId,
          pieces: line.pieces,
          length: line.length,
          width: line.width,
          quantity: line.quantity,
          heatNumber: line.heatNumber,
          ownerCustomerId: line.ownerCustomerId,
          unitPrice: line.unitPrice,
          priceUnit: line.priceUnit,
          invoiceKg: line.invoiceKg,
        })),
      });
      if (result.ok) {
        toast.success(t("receiptForm.posted"));
        router.push("/inventory/receipts");
      } else {
        setFailure({ error: result.error, fields: result.fields });
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{t(`errors.${failure.error as "unexpected"}`)}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup className="grid gap-4 md:grid-cols-3">
        <Field data-invalid={failure?.fields.includes("documentDate") || undefined}>
          <FieldLabel htmlFor="receipt-date">{t("receiptForm.documentDate")}</FieldLabel>
          <Input
            id="receipt-date"
            type="date"
            value={documentDate}
            onChange={(event) => setDocumentDate(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="receipt-supplier">{t("receiptForm.supplier")}</FieldLabel>
          <Input
            id="receipt-supplier"
            value={supplier}
            autoComplete="off"
            onChange={(event) => setSupplier(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="receipt-note">{t("receiptForm.deliveryNote")}</FieldLabel>
          <Input
            id="receipt-note"
            value={deliveryNote}
            autoComplete="off"
            onChange={(event) => setDeliveryNote(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <Label className="flex items-center gap-2 text-sm font-normal">
        <Checkbox
          checked={includesVat}
          onCheckedChange={(value) => setIncludesVat(value === true)}
        />
        {t("receiptForm.pricesIncludeVat", { rate: formatDecimal(settings.vatRate) })}
      </Label>

      {lines.map((line, index) => {
        const item = itemById.get(line.itemId);
        const p = previews[index];
        const dimensioned = item ? isDimensionedUnit(item.baseUnit) : false;
        const id = (field: string) => `receipt-${index}-${field}`;
        return (
          <Card key={line.key}>
            <CardHeader>
              <CardTitle>{t("receiptForm.lineTitle", { index: index + 1 })}</CardTitle>
              {lines.length > 1 ? (
                <CardAction>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("receiptForm.removeLine", { index: index + 1 })}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2Icon />
                  </Button>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-4 md:grid-cols-6">
                <Field className="md:col-span-3">
                  <FieldLabel htmlFor={id("item")}>{t("receiptForm.item")}</FieldLabel>
                  <SearchSelect
                    id={id("item")}
                    value={line.itemId}
                    onChange={(value) =>
                      setLines((current) =>
                        current.map((l, i) => (i === index ? withItem(l, itemById.get(value)) : l)),
                      )
                    }
                    placeholder={t("receiptForm.itemPlaceholder")}
                    options={items.map((option) => ({
                      value: option.id,
                      label: `${option.code} · ${option.name}`,
                      hint: t(`shapes.${option.shape}`),
                    }))}
                  />
                </Field>
                <Field className="md:col-span-3">
                  <FieldLabel htmlFor={id("location")}>{t("receiptForm.location")}</FieldLabel>
                  <NativeSelect
                    id={id("location")}
                    className="w-full"
                    value={line.locationId}
                    onChange={(event) => update(index, { locationId: event.target.value })}
                  >
                    <NativeSelectOption value="">{t("transfer.toPlaceholder")}</NativeSelectOption>
                    {locations.map((location) => (
                      <NativeSelectOption key={location.id} value={location.id}>
                        {location.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>

                {item && dimensioned ? (
                  <>
                    <LineInput
                      id={id("pieces")}
                      label={t("receiptForm.pieces")}
                      value={line.pieces}
                      onChange={(value) => update(index, { pieces: value })}
                      numeric="numeric"
                    />
                    <LineInput
                      id={id("length")}
                      label={t("receiptForm.length")}
                      value={line.length}
                      onChange={(value) => update(index, { length: value })}
                    />
                    {item.baseUnit === "m2" ? (
                      <LineInput
                        id={id("width")}
                        label={t("receiptForm.width")}
                        value={line.width}
                        onChange={(value) => update(index, { width: value })}
                      />
                    ) : null}
                  </>
                ) : item ? (
                  <LineInput
                    id={id("quantity")}
                    label={t("receiptForm.quantity", { unit: t(`units.${item.baseUnit}`) })}
                    value={line.quantity}
                    onChange={(value) => update(index, { quantity: value })}
                  />
                ) : null}

                {item ? (
                  <>
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor={id("heat")}>{t("receiptForm.heat")}</FieldLabel>
                      <Input
                        id={id("heat")}
                        value={line.heatNumber}
                        autoComplete="off"
                        onChange={(event) => update(index, { heatNumber: event.target.value })}
                      />
                    </Field>
                    <Field className="md:col-span-3">
                      <FieldLabel htmlFor={id("owner")}>{t("receiptForm.owner")}</FieldLabel>
                      <NativeSelect
                        id={id("owner")}
                        className="w-full"
                        value={line.ownerCustomerId}
                        onChange={(event) => update(index, { ownerCustomerId: event.target.value })}
                      >
                        <NativeSelectOption value="">
                          {t("receiptForm.ownerOwn")}
                        </NativeSelectOption>
                        {customers.map((customer) => (
                          <NativeSelectOption key={customer.id} value={customer.id}>
                            {customer.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    {line.ownerCustomerId ? null : (
                      <>
                        <LineInput
                          id={id("price")}
                          label={t("receiptForm.price")}
                          value={line.unitPrice}
                          onChange={(value) => update(index, { unitPrice: value })}
                          invalid={failure?.fields.includes("lines") && !decimal(line.unitPrice)}
                        />
                        <Field>
                          <FieldLabel htmlFor={id("price-unit")}>
                            {t("receiptForm.priceUnit")}
                          </FieldLabel>
                          <NativeSelect
                            id={id("price-unit")}
                            className="w-full"
                            value={line.priceUnit}
                            onChange={(event) =>
                              update(index, { priceUnit: event.target.value as PriceUnit })
                            }
                          >
                            {priceUnitsFor(item.baseUnit).map((unit) => (
                              <NativeSelectOption key={unit} value={unit}>
                                {t(`receiptForm.priceUnits.${unit}`)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </Field>
                        {line.priceUnit === "kg" ? (
                          <LineInput
                            id={id("invoice-kg")}
                            label={t("receiptForm.invoiceKg")}
                            hint={t("receiptForm.invoiceKgHint")}
                            value={line.invoiceKg}
                            onChange={(value) => update(index, { invoiceKg: value })}
                          />
                        ) : null}
                      </>
                    )}
                  </>
                ) : null}
              </FieldGroup>
              {p ? (
                <p className="mt-4 text-sm text-muted-foreground tabular-nums" aria-live="polite">
                  {t("receiptForm.preview", {
                    quantity: format.quantity(p.item.baseUnit, p.quantity),
                    mass: p.mass ? format.kg(p.mass) : t("receiptForm.noMass"),
                    value: line.ownerCustomerId
                      ? t("receiptForm.customerValue")
                      : p.value
                        ? t("receiptForm.netValue", {
                            value: formatDecimal(divideDecimal(p.value, "1", 2)),
                          })
                        : t("unknown"),
                  })}
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setLines((current) => [...current, emptyLine()])}
        >
          <PlusIcon />
          {t("receiptForm.addLine")}
        </Button>
        <p className="font-medium tabular-nums">
          {t("receiptForm.total", { value: formatDecimal(divideDecimal(total, "1", 2)) })}
        </p>
      </div>

      <Field>
        <FieldLabel htmlFor="receipt-notes">{t("receiptForm.notes")}</FieldLabel>
        <Textarea
          id="receipt-notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {t("receiptForm.submit")}
        </Button>
      </div>
    </form>
  );
}

function LineInput({
  id,
  label,
  hint,
  value,
  onChange,
  numeric = "decimal",
  invalid,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: "decimal" | "numeric";
  invalid?: boolean;
}) {
  const t = useTranslations("inventory");
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        inputMode={numeric}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <FieldError>{t("errors.price_required")}</FieldError>
      ) : hint ? (
        <FieldDescription>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}
