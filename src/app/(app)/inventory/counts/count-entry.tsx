"use client";

import { CheckIcon, PlusIcon, SendIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { SearchSelect } from "@/components/shared/search-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addDecimals, compareDecimals, formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import {
  addCountLineAction,
  decideCountAction,
  setCountLineAction,
  submitCountAction,
} from "@/modules/inventory/actions";
import type { StockCountDetail, StockCountLine, StockItem } from "@/modules/inventory/queries";
import { isDimensionedUnit } from "@/modules/inventory/rules";
import { useStockFormat } from "../use-stock-format";

/** Counted value as typed: pieces for dimensioned items, else the quantity. */
function countedText(line: StockCountLine): string {
  if (isDimensionedUnit(line.baseUnit)) {
    return line.countedPieces === null ? "" : String(line.countedPieces);
  }
  return formatDecimal(line.countedQuantity);
}

function difference(line: StockCountLine): string | null {
  if (line.countedQuantity === null) return null;
  return addDecimals([line.countedQuantity, `-${line.expectedQuantity}`]);
}

export function CountEntry({
  count,
  items,
  can,
}: {
  count: StockCountDetail;
  items: StockItem[];
  can: { move: boolean; approve: boolean };
}) {
  const t = useTranslations("inventory.counts");
  const tErrors = useTranslations("inventory.errors");
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");
  const editable = count.status === "open" && can.move;
  const counted = count.lines.filter((l) => l.countedQuantity !== null).length;
  const differences = count.lines.filter((l) => {
    const diff = difference(l);
    return diff !== null && compareDecimals(diff, "0") !== 0;
  }).length;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(done);
      } else {
        toast.error(tErrors((result.error ?? "unexpected") as "unexpected"));
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("summary", { counted, lines: count.lines.length, differences })}
      </p>
      {count.status === "submitted" ? (
        <Alert>
          <AlertDescription>{t("waiting")}</AlertDescription>
        </Alert>
      ) : null}
      {count.status === "posted" ? (
        <Alert>
          <AlertDescription>{t("postedNote")}</AlertDescription>
        </Alert>
      ) : null}
      {count.status === "cancelled" && count.decisionNote ? (
        <Alert>
          <AlertDescription>{t("cancelledNote", { note: count.decisionNote })}</AlertDescription>
        </Alert>
      ) : null}

      {count.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noLines")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {count.lines.map((line) => (
            <CountLineRow key={line.id} line={line} editable={editable} />
          ))}
        </ul>
      )}

      {editable ? <FoundLineForm count={count} items={items} /> : null}

      <div className="flex flex-wrap gap-2">
        {editable ? (
          <Button
            size="lg"
            disabled={pending}
            onClick={() => run(() => submitCountAction(count.id), t("submitted"))}
          >
            <SendIcon />
            {t("submit")}
          </Button>
        ) : null}
        {can.approve && count.status === "submitted" ? (
          <Button
            size="lg"
            disabled={pending}
            onClick={() =>
              run(() => decideCountAction({ countId: count.id, post: true, note: "" }), t("posted"))
            }
          >
            <CheckIcon />
            {t("post")}
          </Button>
        ) : null}
        {can.approve && (count.status === "open" || count.status === "submitted") ? (
          <Button size="lg" variant="outline" onClick={() => setCancelling((v) => !v)}>
            <XIcon />
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      {cancelling ? (
        <div className="flex max-w-xl flex-col gap-2">
          <Field>
            <FieldLabel htmlFor="count-cancel-note">{t("cancelReason")}</FieldLabel>
            <Textarea
              id="count-cancel-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Button
            variant="destructive"
            className="w-fit"
            disabled={pending}
            onClick={() =>
              run(() => decideCountAction({ countId: count.id, post: false, note }), t("cancelled"))
            }
          >
            {t("cancel")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CountLineRow({ line, editable }: { line: StockCountLine; editable: boolean }) {
  const t = useTranslations("inventory.counts.lines");
  const tUnits = useTranslations("inventory.units");
  const tErrors = useTranslations("inventory.errors");
  const format = useStockFormat();
  const [value, setValue] = useState(countedText(line));
  const [invalid, setInvalid] = useState(false);
  const [pending, startTransition] = useTransition();
  const dimensioned = isDimensionedUnit(line.baseUnit);
  const diff = difference(line);
  const size = dimensioned ? format.size(line.length, line.width) : null;
  const expected = dimensioned
    ? format.pieces(line.expectedPieces, line.length, line.width)
    : format.quantity(line.baseUnit, line.expectedQuantity);

  const save = () => {
    if (value === countedText(line)) return;
    setInvalid(false);
    startTransition(async () => {
      const result = await setCountLineAction({ lineId: line.id, counted: value });
      if (result.ok) return;
      if (result.error === "invalid" || result.error === "invalid_line") setInvalid(true);
      else toast.error(tErrors(result.error));
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };

  return (
    <li className="rounded-lg border p-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <div className="font-medium">
            {line.itemCode} · {line.itemName}
            {line.found ? (
              <Badge variant="outline" className="ml-2">
                {t("found")}
              </Badge>
            ) : null}
          </div>
          <div className="text-sm text-muted-foreground">
            {[line.location, line.lotNumber, line.heatNumber, size].filter(Boolean).join(" · ")}
          </div>
          <div className="text-sm">
            {t("expected")}: <span className="tabular-nums">{expected}</span>
          </div>
        </div>
        <Field className="w-32" data-invalid={invalid || undefined}>
          <FieldLabel htmlFor={`count-${line.id}`} className="sr-only">
            {t("countedLabel", {
              item: line.itemCode,
              lot: line.lotNumber ?? t("found"),
              size: size ?? "",
            })}
          </FieldLabel>
          <div className="flex items-center gap-1">
            <Input
              id={`count-${line.id}`}
              value={value}
              inputMode="decimal"
              autoComplete="off"
              disabled={!editable || pending}
              placeholder="—"
              className="h-12 text-lg tabular-nums"
              aria-invalid={invalid || undefined}
              onChange={(event) => setValue(event.target.value)}
              onBlur={save}
            />
            <span className="text-sm text-muted-foreground">
              {dimensioned ? t("piecesUnit") : tUnits(line.baseUnit)}
            </span>
          </div>
          {invalid ? <FieldError>{tErrors("invalid_line")}</FieldError> : null}
        </Field>
        <div
          className={cn(
            "w-28 text-right text-sm tabular-nums",
            diff !== null && compareDecimals(diff, "0") !== 0 && "font-medium text-destructive",
          )}
        >
          {diff === null ? t("notCounted") : format.quantity(line.baseUnit, diff)}
        </div>
      </form>
    </li>
  );
}

function FoundLineForm({ count, items }: { count: StockCountDetail; items: StockItem[] }) {
  const t = useTranslations("inventory.counts");
  const tErrors = useTranslations("inventory.errors");
  const tUnits = useTranslations("inventory.units");
  const choices = count.itemId ? items.filter((i) => i.id === count.itemId) : items;
  const [itemId, setItemId] = useState(choices.length === 1 ? (choices[0]?.id ?? "") : "");
  const item = choices.find((i) => i.id === itemId);
  const [locationId, setLocationId] = useState(count.locations[0]?.id ?? count.locationId);
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [counted, setCounted] = useState("1");
  const [fields, setFields] = useState<readonly string[]>([]);
  const [pending, startTransition] = useTransition();

  const chooseItem = (id: string) => {
    setItemId(id);
    const chosen = choices.find((i) => i.id === id);
    setLength(formatDecimal(chosen?.standardLength ?? null));
    setWidth(formatDecimal(chosen?.standardWidth ?? null));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFields([]);
    startTransition(async () => {
      const dimensioned = item ? isDimensionedUnit(item.baseUnit) : false;
      const result = await addCountLineAction({
        countId: count.id,
        itemId,
        locationId,
        length: dimensioned ? length : "",
        width: item?.baseUnit === "m2" ? width : "",
        counted,
      });
      if (result.ok) {
        toast.success(t("foundAdded"));
      } else if (result.fields.length > 0) {
        setFields(result.fields);
      } else {
        toast.error(tErrors(result.error));
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("foundTitle")}</CardTitle>
        <CardDescription>{t("locationHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field className="sm:col-span-2" data-invalid={fields.includes("itemId") || undefined}>
            <FieldLabel htmlFor="found-item">{t("foundItem")}</FieldLabel>
            <SearchSelect
              id="found-item"
              value={itemId}
              onChange={chooseItem}
              placeholder={t("foundItemPlaceholder")}
              options={choices.map((i) => ({ value: i.id, label: i.code, hint: i.name }))}
            />
          </Field>
          <Field data-invalid={fields.includes("locationId") || undefined}>
            <FieldLabel htmlFor="found-location">{t("foundLocation")}</FieldLabel>
            <NativeSelect
              id="found-location"
              className="w-full"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {count.locations.map((l) => (
                <NativeSelectOption key={l.id} value={l.id}>
                  {l.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {item && isDimensionedUnit(item.baseUnit) ? (
            <Field data-invalid={fields.includes("length") || undefined}>
              <FieldLabel htmlFor="found-length">{t("foundLength")}</FieldLabel>
              <Input
                id="found-length"
                inputMode="decimal"
                value={length}
                onChange={(event) => setLength(event.target.value)}
              />
            </Field>
          ) : null}
          {item?.baseUnit === "m2" ? (
            <Field data-invalid={fields.includes("width") || undefined}>
              <FieldLabel htmlFor="found-width">{t("foundWidth")}</FieldLabel>
              <Input
                id="found-width"
                inputMode="decimal"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
            </Field>
          ) : null}
          <Field data-invalid={fields.includes("counted") || undefined}>
            <FieldLabel htmlFor="found-counted">
              {t("foundCounted", { unit: item ? tUnits(item.baseUnit) : "kg" })}
            </FieldLabel>
            <Input
              id="found-counted"
              inputMode="decimal"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="outline" disabled={pending || !itemId}>
              <PlusIcon />
              {t("foundAdd")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
