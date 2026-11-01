"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatDecimal } from "@/lib/decimal";
import { postTransferAction, requestAdjustmentAction } from "@/modules/inventory/actions";
import type { StockBalanceRow, StockItemRow, StockLocation } from "@/modules/inventory/queries";
import { isDimensionedUnit } from "@/modules/inventory/rules";
import { useStockFormat } from "../use-stock-format";

type Failure = { error: string; fields: readonly string[] };

function useSubmit() {
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  return { failure, setFailure, pending, startTransition };
}

function NumberField({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const t = useTranslations("inventory");
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        autoComplete="off"
        className="h-12 text-lg"
        aria-invalid={invalid || undefined}
      />
      {invalid ? <FieldError>{t("errors.invalid")}</FieldError> : null}
    </Field>
  );
}

function MovementSheet({
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
  const t = useTranslations("inventory");
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <FieldGroup>
            {failure && failure.fields.length === 0 ? (
              <Alert variant="destructive">
                <AlertDescription>{t(`errors.${failure.error as "unexpected"}`)}</AlertDescription>
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

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

export function TransferSheet({
  item,
  balance,
  locations,
  onClose,
}: {
  item: StockItemRow;
  balance: StockBalanceRow | null;
  locations: StockLocation[];
  onClose: () => void;
}) {
  return balance ? (
    <TransferForm
      key={`${balance.lotId}:${balance.locationId}:${balance.length}:${balance.width}`}
      item={item}
      balance={balance}
      locations={locations}
      onClose={onClose}
    />
  ) : null;
}

function TransferForm({
  item,
  balance,
  locations,
  onClose,
}: {
  item: StockItemRow;
  balance: StockBalanceRow;
  locations: StockLocation[];
  onClose: () => void;
}) {
  const t = useTranslations("inventory");
  const format = useStockFormat();
  const [key] = useState(() => crypto.randomUUID());
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(isDimensionedUnit(item.baseUnit) ? "1" : "");
  const [notes, setNotes] = useState("");
  const { failure, setFailure, pending, startTransition } = useSubmit();
  const dimensioned = isDimensionedUnit(item.baseUnit);
  const invalid = (field: string) => failure?.fields.includes(field) ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const result = await postTransferAction({
        idempotencyKey: key,
        itemId: item.id,
        lotId: balance.lotId,
        fromLocationId: balance.locationId,
        toLocationId: to,
        length: balance.length ?? "",
        width: balance.width ?? "",
        pieces: dimensioned ? amount : "",
        quantity: dimensioned ? "" : amount,
        notes,
      });
      if (result.ok) {
        toast.success(t("transfer.done"));
        onClose();
      } else {
        setFailure({ error: result.error, fields: result.fields });
      }
    });
  };

  return (
    <MovementSheet
      open
      onClose={onClose}
      title={t("transfer.title")}
      description={t("transfer.description", {
        lot: balance.lotNumber,
        location: balance.location,
      })}
      formId="stock-transfer-form"
      submitLabel={t("transfer.submit")}
      pending={pending}
      failure={failure}
    >
      <form id="stock-transfer-form" onSubmit={submit} noValidate className="contents">
        <Field data-invalid={invalid("toLocationId") || undefined}>
          <FieldLabel htmlFor="transfer-to">{t("transfer.to")}</FieldLabel>
          <NativeSelect
            id="transfer-to"
            className="h-12 w-full"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-invalid={invalid("toLocationId") || undefined}
          >
            <NativeSelectOption value="">{t("transfer.toPlaceholder")}</NativeSelectOption>
            {locations
              .filter((l) => !l.archived && l.id !== balance.locationId)
              .map((l) => (
                <NativeSelectOption key={l.id} value={l.id}>
                  {l.label}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          {invalid("toLocationId") ? <FieldError>{t("errors.invalid")}</FieldError> : null}
        </Field>
        <NumberField
          id="transfer-amount"
          label={
            dimensioned
              ? t("transfer.pieces", {
                  available: format.pieces(balance.pieces, balance.length, balance.width),
                })
              : t("transfer.quantity", {
                  unit: t(`units.${item.baseUnit}`),
                  available: formatDecimal(balance.quantity),
                })
          }
          value={amount}
          onChange={setAmount}
          invalid={invalid("pieces") || invalid("quantity")}
        />
        <Field>
          <FieldLabel htmlFor="transfer-notes">{t("transfer.notes")}</FieldLabel>
          <Textarea
            id="transfer-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </form>
    </MovementSheet>
  );
}

// ---------------------------------------------------------------------------
// Correction (proposed; posted on approval or at once by an approver)
// ---------------------------------------------------------------------------

export function AdjustmentSheet({
  item,
  open,
  balance,
  locations,
  canPost,
  onClose,
}: {
  item: StockItemRow;
  open: boolean;
  /** Null: found material without a lot (always an increase). */
  balance: StockBalanceRow | null;
  locations: StockLocation[];
  canPost: boolean;
  onClose: () => void;
}) {
  return open ? (
    <AdjustmentForm
      key={balance ? `${balance.lotId}:${balance.locationId}:${balance.length}` : "found"}
      item={item}
      balance={balance}
      locations={locations}
      canPost={canPost}
      onClose={onClose}
    />
  ) : null;
}

function AdjustmentForm({
  item,
  balance,
  locations,
  canPost,
  onClose,
}: {
  item: StockItemRow;
  balance: StockBalanceRow | null;
  locations: StockLocation[];
  canPost: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("inventory");
  const [key] = useState(() => crypto.randomUUID());
  const dimensioned = isDimensionedUnit(item.baseUnit);
  const [direction, setDirection] = useState<"add" | "remove">(balance ? "remove" : "add");
  const [locationId, setLocationId] = useState(balance?.locationId ?? item.defaultLocationId ?? "");
  const [length, setLength] = useState(formatDecimal(balance?.length ?? item.standardLength));
  const [width, setWidth] = useState(formatDecimal(balance?.width ?? item.standardWidth));
  const [amount, setAmount] = useState(dimensioned ? "1" : "");
  const [reason, setReason] = useState("");
  const [post, setPost] = useState(false);
  const { failure, setFailure, pending, startTransition } = useSubmit();
  const invalid = (field: string) => failure?.fields.includes(field) ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const signed = direction === "remove" && amount.trim() !== "" ? `-${amount.trim()}` : amount;
    startTransition(async () => {
      const result = await requestAdjustmentAction({
        idempotencyKey: key,
        reason,
        post: canPost && post,
        itemId: item.id,
        lotId: balance?.lotId ?? "",
        locationId,
        length: dimensioned ? length : "",
        width: item.baseUnit === "m2" ? width : "",
        pieces: dimensioned ? signed : "",
        quantity: dimensioned ? "" : signed,
      });
      if (result.ok) {
        toast.success(t(canPost && post ? "adjustment.posted" : "adjustment.requested"));
        onClose();
      } else {
        setFailure({ error: result.error, fields: result.fields });
      }
    });
  };

  return (
    <MovementSheet
      open
      onClose={onClose}
      title={balance ? t("adjustment.title") : t("adjustment.titleFound")}
      description={
        balance
          ? t("adjustment.context", { lot: balance.lotNumber, location: balance.location })
          : t("adjustment.description")
      }
      formId="stock-adjustment-form"
      submitLabel={canPost && post ? t("adjustment.submitPost") : t("adjustment.submit")}
      pending={pending}
      failure={failure}
    >
      <form id="stock-adjustment-form" onSubmit={submit} noValidate className="contents">
        {balance ? (
          <Field>
            <FieldLabel>{t("adjustment.direction")}</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {(["remove", "add"] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="lg"
                  variant={direction === value ? "default" : "outline"}
                  aria-pressed={direction === value}
                  onClick={() => setDirection(value)}
                >
                  {t(`adjustment.${value}`)}
                </Button>
              ))}
            </div>
          </Field>
        ) : (
          <>
            <Field data-invalid={invalid("locationId") || undefined}>
              <FieldLabel htmlFor="adjustment-location">{t("adjustment.location")}</FieldLabel>
              <NativeSelect
                id="adjustment-location"
                className="h-12 w-full"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                <NativeSelectOption value="">{t("transfer.toPlaceholder")}</NativeSelectOption>
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
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  id="adjustment-length"
                  label={t("adjustment.length")}
                  value={length}
                  onChange={setLength}
                  invalid={invalid("length")}
                />
                {item.baseUnit === "m2" ? (
                  <NumberField
                    id="adjustment-width"
                    label={t("adjustment.width")}
                    value={width}
                    onChange={setWidth}
                    invalid={invalid("width")}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        )}
        <NumberField
          id="adjustment-amount"
          label={
            dimensioned
              ? t("adjustment.pieces")
              : t("adjustment.quantity", { unit: t(`units.${item.baseUnit}`) })
          }
          value={amount}
          onChange={setAmount}
          invalid={invalid("pieces") || invalid("quantity") || invalid("lotId")}
        />
        <Field data-invalid={invalid("reason") || undefined}>
          <FieldLabel htmlFor="adjustment-reason">{t("adjustment.reason")}</FieldLabel>
          <Textarea
            id="adjustment-reason"
            rows={2}
            value={reason}
            placeholder={t("adjustment.reasonPlaceholder")}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={invalid("reason") || undefined}
          />
          {invalid("reason") ? <FieldError>{t("errors.reason_required")}</FieldError> : null}
        </Field>
        {canPost ? (
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={post} onCheckedChange={(value) => setPost(value === true)} />
            {t("adjustment.post")}
          </Label>
        ) : (
          <p className="text-sm text-muted-foreground">{t("adjustment.description")}</p>
        )}
      </form>
    </MovementSheet>
  );
}
