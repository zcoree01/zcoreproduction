"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  addDecimals,
  compareDecimals,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "@/lib/decimal";
import { postIssueAction, postReturnAction } from "@/modules/inventory/actions";
import {
  missingPieces,
  offcutLength,
  piecesFromBar,
  rankIssueBuckets,
} from "@/modules/inventory/order-rules";
import type { StockLocation } from "@/modules/inventory/queries";
import { isDimensionedUnit, lineQuantity } from "@/modules/inventory/rules";
import { useStockFormat } from "../../inventory/use-stock-format";
import type { OrderMaterialView } from "./material-panel";

type Failure = { error: string; fields: readonly string[] };

function SheetFrame({
  open,
  onClose,
  title,
  description,
  formId,
  submitLabel,
  pending,
  failure,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  formId: string;
  submitLabel: string;
  pending: boolean;
  failure: Failure | null;
  children: ReactNode;
}) {
  const t = useTranslations("inventory.errors");
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <FieldGroup>
            {failure ? (
              <Alert variant="destructive">
                <AlertDescription>{t(failure.error as "unexpected")}</AlertDescription>
              </Alert>
            ) : null}
            {children}
          </FieldGroup>
        </div>
        <SheetFooter className="border-t">
          <Button type="submit" form={formId} size="lg" disabled={pending}>
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function NumberInput({
  id,
  label,
  value,
  onChange,
  hint,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  invalid?: boolean;
}) {
  const t = useTranslations("inventory.errors");
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        inputMode="decimal"
        autoComplete="off"
        className="h-12 text-lg"
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <FieldError>{t("invalid")}</FieldError>
      ) : hint ? (
        <FieldDescription>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export function IssueSheet(props: {
  open: boolean;
  onClose: () => void;
  order: { id: string; orderNumber: string; customerId: string };
  material: OrderMaterialView;
  locations: StockLocation[];
  remnantMinLength: string;
  /** Lot of a scanned label: its first bucket is chosen. */
  initialLotId?: string;
}) {
  return props.open ? <IssueForm {...props} /> : null;
}

function IssueForm({
  onClose,
  order,
  material,
  locations,
  remnantMinLength,
  initialLotId,
}: {
  onClose: () => void;
  order: { id: string; orderNumber: string; customerId: string };
  material: OrderMaterialView;
  locations: StockLocation[];
  remnantMinLength: string;
  initialLotId?: string;
}) {
  const t = useTranslations("inventory.issue");
  const tUnits = useTranslations("inventory.units");
  const format = useStockFormat();
  const item = material.item;
  const unit = item?.baseUnit ?? "kg";
  const dimensioned = isDimensionedUnit(unit);
  const perPiece = unit === "mm" ? material.plan.perPiece : null;
  const buckets = useMemo(
    () =>
      rankIssueBuckets(material.buckets, {
        customerId: order.customerId,
        perPiece,
        standardLength: item?.standardLength ?? null,
        minRemnant: remnantMinLength,
      }),
    [material.buckets, order.customerId, perPiece, item?.standardLength, remnantMinLength],
  );
  const keyOf = (b: (typeof buckets)[number]) =>
    `${b.lotId}|${b.locationId}|${b.length}|${b.width}`;

  const [key] = useState(() => crypto.randomUUID());
  const initialBucket = buckets.find((b) => b.lotId === initialLotId) ?? buckets[0];
  const [bucketKey, setBucketKey] = useState(initialBucket ? keyOf(initialBucket) : "");
  const bucket = buckets.find((b) => keyOf(b) === bucketKey) ?? null;
  const customerMaterial = bucket?.ownerCustomerId != null;
  const [mode, setMode] = useState<"whole" | "cut">("cut");
  const [pieces, setPieces] = useState("1");
  const [quantity, setQuantity] = useState("");
  const maxCut = bucket?.length && perPiece ? piecesFromBar(bucket.length, perPiece) : null;
  const [cutPieces, setCutPieces] = useState(maxCut ? String(maxCut) : "");
  const [offcut, setOffcut] = useState("");
  const [offcutWidth, setOffcutWidth] = useState("");
  const [offcutLocation, setOffcutLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  const suggestedOffcut =
    bucket?.length && perPiece && /^\d+$/.test(cutPieces)
      ? offcutLength(bucket.length, Number(cutPieces), perPiece)
      : null;
  const offcutValue = offcut || (unit === "mm" ? formatDecimal(suggestedOffcut) : "");
  const cutting = dimensioned && mode === "cut" && !customerMaterial;

  const chooseBucket = (next: string) => {
    setBucketKey(next);
    const chosen = buckets.find((b) => keyOf(b) === next);
    const max = chosen?.length && perPiece ? piecesFromBar(chosen.length, perPiece) : null;
    setCutPieces(max ? String(max) : "");
    setOffcut("");
  };

  // Base-unit quantity this issue takes out for the order (offcuts put back).
  const issuedNet = (() => {
    if (!bucket || !item) return null;
    const count = /^\d+$/.test(pieces) ? Number(pieces) : null;
    const taken = lineQuantity(unit, {
      pieces: dimensioned ? count : null,
      length: dimensioned ? bucket.length : null,
      width: unit === "m2" ? bucket.width : null,
      quantity: dimensioned ? null : parseDecimal(quantity, 3),
    });
    if (!taken) return null;
    const offcutMm = cutting ? parseDecimal(offcutValue, 1) : null;
    if (unit === "mm" && offcutMm && count) {
      return addDecimals([taken, `-${multiplyDecimal(String(count), offcutMm, 3)}`], 3);
    }
    return taken;
  })();
  const remainingAfter =
    material.reservation && issuedNet
      ? addDecimals([material.reservation.remaining, `-${issuedNet}`], 6)
      : null;
  const stillMissing =
    remainingAfter && material.plan.perPiece && compareDecimals(remainingAfter, "0") > 0
      ? missingPieces(remainingAfter, material.plan.perPiece)
      : 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!bucket || !item) return;
    setFailure(null);
    startTransition(async () => {
      const result = await postIssueAction({
        idempotencyKey: key,
        orderId: order.id,
        itemId: item.id,
        lotId: bucket.lotId,
        locationId: bucket.locationId,
        length: bucket.length ?? "",
        width: bucket.width ?? "",
        pieces: dimensioned ? pieces : "",
        quantity: dimensioned ? "" : quantity,
        cutPieces: cutting && unit === "mm" ? cutPieces : "",
        offcutLength: cutting ? offcutValue : "",
        offcutWidth: cutting && unit === "m2" ? offcutWidth : "",
        offcutLocationId: cutting ? offcutLocation : "",
        notes,
      });
      if (result.ok) {
        toast.success(t("done"));
        onClose();
      } else {
        setFailure({ error: result.error, fields: result.fields });
      }
    });
  };

  const bucketLabel = (b: (typeof buckets)[number]) => {
    const tags = [
      b.ownerCustomerId ? t("customerTag") : null,
      b.remnant ? (b.short ? t("shortTag") : t("remnantTag")) : null,
      b.fits ? null : t("tooShortTag"),
    ].filter(Boolean);
    const amount = isDimensionedUnit(unit)
      ? format.pieces(b.pieces, b.length, b.width)
      : format.quantity(unit, b.quantity);
    return [
      b.lotNumber,
      b.heatNumber,
      b.location,
      amount,
      tags.length ? `(${tags.join(", ")})` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={t("title", { number: order.orderNumber })}
      description={t("description")}
      formId="order-issue-form"
      submitLabel={t("submit")}
      pending={pending || !bucket}
      failure={failure}
    >
      {buckets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <form id="order-issue-form" onSubmit={submit} noValidate className="contents">
          <Field>
            <FieldLabel htmlFor="issue-bucket">{t("bucket")}</FieldLabel>
            <NativeSelect
              id="issue-bucket"
              className="h-12 w-full"
              value={bucketKey}
              onChange={(event) => chooseBucket(event.target.value)}
            >
              {buckets.map((b) => (
                <NativeSelectOption key={keyOf(b)} value={keyOf(b)}>
                  {bucketLabel(b)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          {dimensioned ? (
            <>
              {!customerMaterial ? (
                <Field>
                  <FieldLabel>{t("mode")}</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {(["cut", "whole"] as const).map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="lg"
                        variant={mode === value ? "default" : "outline"}
                        aria-pressed={mode === value}
                        onClick={() => setMode(value)}
                      >
                        {t(value === "cut" ? "modeCut" : "modeWhole")}
                      </Button>
                    ))}
                  </div>
                </Field>
              ) : null}
              <NumberInput
                id="issue-pieces"
                label={t("pieces", {
                  available: bucket
                    ? format.pieces(bucket.pieces, bucket.length, bucket.width)
                    : "",
                })}
                value={pieces}
                onChange={setPieces}
                invalid={failure?.fields.includes("pieces")}
              />
              {cutting && unit === "mm" ? (
                <NumberInput
                  id="issue-cut"
                  label={t("cutPieces")}
                  value={cutPieces}
                  onChange={(value) => {
                    setCutPieces(value);
                    setOffcut("");
                  }}
                  hint={maxCut ? t("cutHint", { max: maxCut }) : undefined}
                  invalid={failure?.fields.includes("cutPieces")}
                />
              ) : null}
              {cutting ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberInput
                      id="issue-offcut"
                      label={t("offcut")}
                      value={offcutValue}
                      onChange={setOffcut}
                      invalid={failure?.fields.includes("offcutLength")}
                      hint={
                        unit === "mm" &&
                        offcutValue &&
                        compareDecimals(parseDecimal(offcutValue, 1) ?? "0", remnantMinLength) < 0
                          ? t("offcutShort", { min: formatDecimal(remnantMinLength) })
                          : t("offcutHint")
                      }
                    />
                    {unit === "m2" ? (
                      <NumberInput
                        id="issue-offcut-width"
                        label={t("offcutWidth")}
                        value={offcutWidth}
                        onChange={setOffcutWidth}
                        invalid={failure?.fields.includes("offcutWidth")}
                      />
                    ) : null}
                  </div>
                  <Field>
                    <FieldLabel htmlFor="issue-offcut-location">{t("offcutLocation")}</FieldLabel>
                    <NativeSelect
                      id="issue-offcut-location"
                      className="w-full"
                      value={offcutLocation}
                      onChange={(event) => setOffcutLocation(event.target.value)}
                    >
                      <NativeSelectOption value="">{t("sameLocation")}</NativeSelectOption>
                      {locations
                        .filter((l) => !l.archived)
                        .map((l) => (
                          <NativeSelectOption key={l.id} value={l.id}>
                            {l.label}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </Field>
                </>
              ) : customerMaterial ? (
                <p className="text-sm text-muted-foreground">{t("offcutCustomer")}</p>
              ) : null}
            </>
          ) : (
            <NumberInput
              id="issue-quantity"
              label={t("quantity", {
                unit: tUnits(unit),
                available: bucket ? formatDecimal(bucket.quantity) : "",
              })}
              value={quantity}
              onChange={setQuantity}
              invalid={failure?.fields.includes("quantity") || failure?.fields.includes("pieces")}
            />
          )}

          {stillMissing > 0 ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t("shortageAfter", { pieces: stillMissing })}
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="issue-notes">{t("notes")}</FieldLabel>
            <Textarea
              id="issue-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </form>
      )}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

export function ReturnSheet(props: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  material: OrderMaterialView;
  locations: StockLocation[];
}) {
  return props.open ? <ReturnForm {...props} /> : null;
}

function ReturnForm({
  onClose,
  orderId,
  material,
  locations,
}: {
  onClose: () => void;
  orderId: string;
  material: OrderMaterialView;
  locations: StockLocation[];
}) {
  const t = useTranslations("inventory.return");
  const tUnits = useTranslations("inventory.units");
  const item = material.item;
  const unit = item?.baseUnit ?? "kg";
  const dimensioned = isDimensionedUnit(unit);
  const lots = useMemo(() => {
    const seen = new Map<string, (typeof material.movements)[number]>();
    for (const m of material.movements) {
      if (m.kind === "issue" && !seen.has(m.lotId)) seen.set(m.lotId, m);
    }
    return [...seen.values()];
  }, [material]);

  const [key] = useState(() => crypto.randomUUID());
  const [lotId, setLotId] = useState(lots[0]?.lotId ?? "");
  const [locationId, setLocationId] = useState(lots[0]?.locationId ?? "");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [pieces, setPieces] = useState("1");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = (field: string) => failure?.fields.includes(field) ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!item) return;
    setFailure(null);
    startTransition(async () => {
      const result = await postReturnAction({
        idempotencyKey: key,
        orderId,
        itemId: item.id,
        lotId,
        locationId,
        length: dimensioned ? length : "",
        width: unit === "m2" ? width : "",
        pieces: dimensioned ? pieces : "",
        quantity: dimensioned ? "" : quantity,
        notes,
      });
      if (result.ok) {
        toast.success(t("done"));
        onClose();
      } else {
        setFailure({ error: result.error, fields: result.fields });
      }
    });
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={t("title")}
      description={t("description")}
      formId="order-return-form"
      submitLabel={t("submit")}
      pending={pending || lots.length === 0}
      failure={failure}
    >
      {lots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noLots")}</p>
      ) : (
        <form id="order-return-form" onSubmit={submit} noValidate className="contents">
          <Field>
            <FieldLabel htmlFor="return-lot">{t("lot")}</FieldLabel>
            <NativeSelect
              id="return-lot"
              className="h-12 w-full"
              value={lotId}
              onChange={(event) => setLotId(event.target.value)}
            >
              {lots.map((lot) => (
                <NativeSelectOption key={lot.lotId} value={lot.lotId}>
                  {[lot.lotNumber, lot.heatNumber].filter(Boolean).join(" · ")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={invalid("locationId") || undefined}>
            <FieldLabel htmlFor="return-location">{t("location")}</FieldLabel>
            <NativeSelect
              id="return-location"
              className="h-12 w-full"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations
                .filter((l) => !l.archived)
                .map((l) => (
                  <NativeSelectOption key={l.id} value={l.id}>
                    {l.label}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          {dimensioned ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  id="return-length"
                  label={t("length")}
                  value={length}
                  onChange={setLength}
                  invalid={invalid("length")}
                />
                {unit === "m2" ? (
                  <NumberInput
                    id="return-width"
                    label={t("width")}
                    value={width}
                    onChange={setWidth}
                    invalid={invalid("width")}
                  />
                ) : null}
              </div>
              <NumberInput
                id="return-pieces"
                label={t("pieces")}
                value={pieces}
                onChange={setPieces}
                invalid={invalid("pieces")}
              />
            </>
          ) : (
            <NumberInput
              id="return-quantity"
              label={t("quantity", { unit: tUnits(unit) })}
              value={quantity}
              onChange={setQuantity}
              invalid={invalid("quantity") || invalid("pieces")}
            />
          )}
          <Field>
            <FieldLabel htmlFor="return-notes">{t("notes")}</FieldLabel>
            <Textarea
              id="return-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </form>
      )}
    </SheetFrame>
  );
}
