"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { toast } from "sonner";
import { SearchSelect } from "@/components/shared/search-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import type { CustomerOption } from "@/modules/customers/queries";
import {
  copyOrderAction,
  createOrderAction,
  updateOrderAction,
} from "@/modules/production-orders/actions";
import type { OrderDetail, ProductChoice } from "@/modules/production-orders/queries";
import { barPlan, type PriorityMode } from "@/modules/production-orders/rules";
import {
  copyOrderSchema,
  createOrderSchema,
  isWholeUnit,
  quantityFitsUnit,
  updateOrderSchema,
  type CopyOrderFormValues,
  type CopyOrderInput,
  type CreateOrderFormValues,
  type CreateOrderInput,
  type OrderActionResult,
  type OrderField,
  type UpdateOrderFormValues,
  type UpdateOrderInput,
} from "@/modules/production-orders/schemas";
import { canEditPlanning } from "@/modules/production-orders/status-rules";

type FormError = Extract<OrderActionResult, { ok: false }>["error"];

export type OrderFormOptions = {
  customers: CustomerOption[];
  products: ProductChoice[];
  priorityMode: PriorityMode;
  /** Today in the organization's time zone (YYYY-MM-DD). */
  today: string;
};

const EMPTY: CreateOrderFormValues = {
  customerId: "",
  productId: "",
  revisionId: "",
  quantity: "",
  dueDate: "",
  priority: "",
  plannedStart: "",
  plannedEnd: "",
  notes: "",
  pieceLength: "",
  kerf: "",
  barLength: "",
  barRemnant: "",
};

const decimalText = (value: string | null) => formatDecimal(value);

/** Shared server-result handling: field errors next to fields, the rest above the form. */
function applyResult(
  result: OrderActionResult,
  setFieldError: (field: OrderField) => void,
  setFormError: (error: FormError) => void,
) {
  if (result.ok) return;
  if (result.error === "invalid" && result.fields.length > 0) {
    for (const field of result.fields) setFieldError(field);
  } else {
    setFormError(result.error);
  }
}

export function CreateOrderButton({ options }: { options: OrderFormOptions }) {
  const t = useTranslations("orders.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("open")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-xl">
          {open ? <CreateOrderForm options={options} onDone={() => setOpen(false)} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function TextField<TValues extends FieldValues, TOut>({
  control,
  name,
  label,
  type,
  inputMode,
  hint,
  error,
  suffix,
  disabled,
}: {
  control: Control<TValues, unknown, TOut>;
  name: FieldPath<TValues>;
  label: string;
  type?: string;
  inputMode?: "decimal" | "numeric";
  hint?: ReactNode;
  error: string;
  suffix?: string;
  disabled?: boolean;
}) {
  const id = `order-${name}`;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              {...field}
              value={String(field.value ?? "")}
              id={id}
              type={type}
              inputMode={inputMode}
              autoComplete="off"
              disabled={disabled}
              aria-invalid={fieldState.invalid || undefined}
            />
            {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
          </div>
          {fieldState.invalid ? (
            <FieldError>
              {fieldState.error?.type === "server" && fieldState.error.message
                ? fieldState.error.message
                : error}
            </FieldError>
          ) : hint ? (
            <FieldDescription>{hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );
}

function PriorityField<TValues extends FieldValues & { priority: string }, TOut>({
  control,
  priorityMode,
  computed,
}: {
  control: Control<TValues, unknown, TOut>;
  priorityMode: PriorityMode;
  /** Computed priority of an existing order (null while creating). */
  computed: number | null;
}) {
  const t = useTranslations("orders.form");
  const tPriority = useTranslations("priority");
  const value = useWatch({ control, name: "priority" as FieldPath<TValues> }) as string;
  const manualInAutomatic = priorityMode === "automatic" && value !== "";
  return (
    <Controller
      name={"priority" as FieldPath<TValues>}
      control={control}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor="order-priority">{t("priority")}</FieldLabel>
          <NativeSelect
            id="order-priority"
            className="w-full"
            value={String(field.value ?? "")}
            onChange={(event) => field.onChange(event.target.value)}
          >
            <NativeSelectOption value="">
              {priorityMode === "automatic"
                ? computed
                  ? t("priorityAutomaticValue", { level: computed })
                  : t("priorityAutomatic")
                : t("priorityNormal")}
            </NativeSelectOption>
            {(["1", "2", "3", "4", "5"] as const).map((level) => (
              <NativeSelectOption key={level} value={level}>
                {level} – {tPriority(`levels.${level}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {manualInAutomatic && (computed === null || String(computed) !== value) ? (
            <Alert className="mt-1">
              <TriangleAlertIcon />
              <AlertTitle>{t("priorityOverrideTitle")}</AlertTitle>
              <AlertDescription>
                {computed === null
                  ? t("priorityOverrideNew")
                  : t("priorityOverride", { computed, chosen: value })}
              </AlertDescription>
            </Alert>
          ) : (
            <FieldDescription>{t("priorityHint")}</FieldDescription>
          )}
        </Field>
      )}
    />
  );
}

/** Live "pieces per bar" from the bar, remnant, piece length and kerf fields. */
function BarPreview({
  values,
  wholePieces,
}: {
  values: {
    barLength: string;
    barRemnant: string;
    pieceLength: string;
    kerf: string;
    quantity: string;
  };
  wholePieces: boolean;
}) {
  const t = useTranslations("orders.form");
  const read = (value: string) => (value.trim() ? parseDecimal(value, 3) : null);
  const plan = barPlan({
    barLength: read(values.barLength),
    remnant: read(values.barRemnant),
    pieceLength: read(values.pieceLength),
    kerf: read(values.kerf),
    quantity: read(values.quantity),
    wholePieces,
  });
  if (!plan) return <p className="text-sm text-muted-foreground">{t("barHint")}</p>;
  return (
    <p className="text-sm" data-testid="bar-plan">
      {t("barResult", {
        pieces: plan.piecesPerBar,
        usable: formatDecimal(plan.usableLength),
        perPiece: formatDecimal(plan.perPiece),
      })}
      {plan.barsNeeded !== null ? ` ${t("barsNeeded", { bars: plan.barsNeeded })}` : null}
    </p>
  );
}

function PieceFields<
  TValues extends FieldValues & {
    quantity: string;
    pieceLength: string;
    kerf: string;
    barLength: string;
    barRemnant: string;
  },
  TOut,
>({
  control,
  wholePieces,
  disabled,
}: {
  control: Control<TValues, unknown, TOut>;
  wholePieces: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("orders.form");
  const watched = useWatch({ control }) as Partial<Record<string, string>>;
  const mm = t("mm");
  return (
    <FieldSet>
      <FieldLegend variant="label">{t("barTitle")}</FieldLegend>
      <FieldDescription>{t("barDescription")}</FieldDescription>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={"barLength" as FieldPath<TValues>}
          label={t("barLength")}
          inputMode="decimal"
          suffix={mm}
          error={t("fieldErrors.length")}
          disabled={disabled}
        />
        <TextField
          control={control}
          name={"barRemnant" as FieldPath<TValues>}
          label={t("barRemnant")}
          inputMode="decimal"
          suffix={mm}
          error={t("fieldErrors.barRemnant")}
          disabled={disabled}
        />
        <TextField
          control={control}
          name={"pieceLength" as FieldPath<TValues>}
          label={t("pieceLength")}
          inputMode="decimal"
          suffix={mm}
          error={t("fieldErrors.length")}
          disabled={disabled}
        />
        <TextField
          control={control}
          name={"kerf" as FieldPath<TValues>}
          label={t("kerf")}
          inputMode="decimal"
          suffix={mm}
          error={t("fieldErrors.kerf")}
          disabled={disabled}
        />
      </div>
      <BarPreview
        wholePieces={wholePieces}
        values={{
          barLength: watched.barLength ?? "",
          barRemnant: watched.barRemnant ?? "",
          pieceLength: watched.pieceLength ?? "",
          kerf: watched.kerf ?? "",
          quantity: watched.quantity ?? "",
        }}
      />
    </FieldSet>
  );
}

function ScheduleFields<
  TValues extends FieldValues & {
    quantity: string;
    dueDate: string;
    priority: string;
    plannedStart: string;
    plannedEnd: string;
    notes: string;
  },
  TOut,
>({
  control,
  unitLabel,
  wholePieces,
  priorityMode,
  computedPriority,
  quantityDisabled,
}: {
  control: Control<TValues, unknown, TOut>;
  unitLabel: string;
  wholePieces: boolean;
  priorityMode: PriorityMode;
  computedPriority: number | null;
  quantityDisabled?: boolean;
}) {
  const t = useTranslations("orders.form");
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={"quantity" as FieldPath<TValues>}
          label={t("quantity")}
          inputMode={wholePieces ? "numeric" : "decimal"}
          suffix={unitLabel}
          error={wholePieces ? t("fieldErrors.quantityWhole") : t("fieldErrors.quantity")}
          hint={quantityDisabled ? t("quantityLocked") : undefined}
          disabled={quantityDisabled}
        />
        <TextField
          control={control}
          name={"dueDate" as FieldPath<TValues>}
          label={t("dueDate")}
          type="date"
          error={t("fieldErrors.dueDate")}
          hint={t("dueDateHint")}
        />
      </div>
      <PriorityField control={control} priorityMode={priorityMode} computed={computedPriority} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={"plannedStart" as FieldPath<TValues>}
          label={t("plannedStart")}
          type="date"
          error={t("fieldErrors.date")}
        />
        <TextField
          control={control}
          name={"plannedEnd" as FieldPath<TValues>}
          label={t("plannedEnd")}
          type="date"
          error={t("fieldErrors.plannedEnd")}
        />
      </div>
      <Controller
        name={"notes" as FieldPath<TValues>}
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor="order-notes">{t("notes")}</FieldLabel>
            <Textarea
              {...field}
              value={String(field.value ?? "")}
              id="order-notes"
              rows={3}
              aria-invalid={fieldState.invalid || undefined}
            />
            {fieldState.invalid ? <FieldError>{t("fieldErrors.notes")}</FieldError> : null}
          </Field>
        )}
      />
    </>
  );
}

function CreateOrderForm({ options, onDone }: { options: OrderFormOptions; onDone: () => void }) {
  const t = useTranslations("orders.form");
  const tUnits = useTranslations("productUnits");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CreateOrderFormValues, unknown, CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: EMPTY,
  });
  const productId = useWatch({ control: form.control, name: "productId" });
  const revisionId = useWatch({ control: form.control, name: "revisionId" });
  const product = options.products.find((p) => p.id === productId) ?? null;
  const revision = product?.revisions.find((r) => r.id === revisionId) ?? null;
  const unit = product?.unit ?? "pcs";
  const wholePieces = isWholeUnit(unit);

  const chooseProduct = (id: string) => {
    form.setValue("productId", id, { shouldValidate: form.formState.isSubmitted });
    const chosen = options.products.find((p) => p.id === id);
    const current = chosen?.revisions[0];
    form.setValue("revisionId", current?.id ?? "");
    form.setValue("pieceLength", decimalText(current?.cutLength ?? null));
    form.setValue("kerf", decimalText(current?.kerf ?? null));
    if (chosen?.customerId) form.setValue("customerId", chosen.customerId);
  };

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    const values = form.getValues();
    if (!quantityFitsUnit(values.quantity.replace(",", "."), unit)) {
      form.setError("quantity", { type: "server", message: t("fieldErrors.quantityWhole") });
      return;
    }
    startTransition(async () => {
      const result = await createOrderAction(values);
      if (result.ok) {
        toast.success(t("createdToast"));
        onDone();
        router.push(`/orders/${result.id}`);
        return;
      }
      applyResult(result, (field) => form.setError(field, { type: "server" }), setFormError);
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("createTitle")}</SheetTitle>
        <SheetDescription>{t("createDescription")}</SheetDescription>
      </SheetHeader>
      <form id="order-form" onSubmit={onSubmit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          {options.products.length === 0 ? (
            <Alert>
              <AlertDescription>{t("noProducts")}</AlertDescription>
            </Alert>
          ) : null}
          <Controller
            name="productId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="order-productId">{t("product")}</FieldLabel>
                <SearchSelect
                  id="order-productId"
                  value={field.value}
                  onChange={chooseProduct}
                  placeholder={t("productPlaceholder")}
                  invalid={fieldState.invalid}
                  options={options.products.map((p) => ({
                    value: p.id,
                    label: p.partNumber,
                    hint: p.name,
                  }))}
                />
                {fieldState.invalid ? (
                  <FieldError>{t("fieldErrors.productId")}</FieldError>
                ) : (
                  <FieldDescription>{t("productHint")}</FieldDescription>
                )}
              </Field>
            )}
          />
          {product ? (
            <Controller
              name="revisionId"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="order-revisionId">{t("revision")}</FieldLabel>
                  <NativeSelect
                    id="order-revisionId"
                    className="w-full"
                    value={field.value}
                    onChange={(event) => {
                      field.onChange(event.target.value);
                      const chosen = product.revisions.find((r) => r.id === event.target.value);
                      form.setValue("pieceLength", decimalText(chosen?.cutLength ?? null));
                      form.setValue("kerf", decimalText(chosen?.kerf ?? null));
                    }}
                  >
                    {product.revisions.map((r) => (
                      <NativeSelectOption key={r.id} value={r.id}>
                        {r.isCurrent
                          ? t("revisionCurrent", { revision: r.revision ?? t("unlabeled") })
                          : t("revisionOld", { revision: r.revision ?? t("unlabeled") })}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {revision && !revision.isCurrent ? (
                    <Alert className="mt-1">
                      <TriangleAlertIcon />
                      <AlertDescription>{t("oldRevisionWarning")}</AlertDescription>
                    </Alert>
                  ) : (
                    <FieldDescription>{t("revisionHint")}</FieldDescription>
                  )}
                </Field>
              )}
            />
          ) : null}
          <Controller
            name="customerId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="order-customerId">{t("customer")}</FieldLabel>
                <SearchSelect
                  id="order-customerId"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("customerPlaceholder")}
                  invalid={fieldState.invalid}
                  options={options.customers.map((c) => ({
                    value: c.id,
                    label: c.name,
                    hint: t("customerNumberHint", { number: c.number }),
                  }))}
                />
                {fieldState.invalid ? (
                  <FieldError>{t("fieldErrors.customerId")}</FieldError>
                ) : (
                  <FieldDescription>{t("customerHint")}</FieldDescription>
                )}
              </Field>
            )}
          />
          <ScheduleFields
            control={form.control}
            unitLabel={tUnits(unit)}
            wholePieces={wholePieces}
            priorityMode={options.priorityMode}
            computedPriority={null}
          />
          <PieceFields control={form.control} wholePieces={wholePieces} />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="order-form" disabled={pending}>
          {pending ? t("submitting") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}

function toEditValues(order: OrderDetail): UpdateOrderFormValues {
  return {
    quantity: formatDecimal(order.quantity),
    dueDate: order.dueDate,
    priority: order.priority === null ? "" : (String(order.priority) as "1"),
    plannedStart: order.plannedStart ?? "",
    plannedEnd: order.plannedEnd ?? "",
    notes: order.notes ?? "",
    pieceLength: formatDecimal(order.pieceLength),
    kerf: formatDecimal(order.kerf),
    barLength: formatDecimal(order.barLength),
    barRemnant: formatDecimal(order.barRemnant),
  };
}

export function EditOrderSheet({
  open,
  onOpenChange,
  order,
  priorityMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail;
  priorityMode: PriorityMode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-xl">
        {open ? (
          <EditOrderForm
            order={order}
            priorityMode={priorityMode}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EditOrderForm({
  order,
  priorityMode,
  onDone,
}: {
  order: OrderDetail;
  priorityMode: PriorityMode;
  onDone: () => void;
}) {
  const t = useTranslations("orders.form");
  const tUnits = useTranslations("productUnits");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<UpdateOrderFormValues, unknown, UpdateOrderInput>({
    resolver: zodResolver(updateOrderSchema),
    defaultValues: toEditValues(order),
  });
  const planning = canEditPlanning(order.status);
  const wholePieces = isWholeUnit(order.unit);

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    const values = form.getValues();
    if (planning && !quantityFitsUnit(values.quantity.replace(",", "."), order.unit)) {
      form.setError("quantity", { type: "server", message: t("fieldErrors.quantityWhole") });
      return;
    }
    startTransition(async () => {
      const result = await updateOrderAction(order.id, values);
      if (result.ok) {
        toast.success(t("updatedToast", { number: order.orderNumber }));
        onDone();
        router.refresh();
        return;
      }
      applyResult(
        result,
        (field) => {
          if (field !== "customerId" && field !== "productId" && field !== "revisionId") {
            form.setError(field, { type: "server" });
          }
        },
        setFormError,
      );
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("editTitle", { number: order.orderNumber })}</SheetTitle>
        <SheetDescription>
          {planning ? t("editDescription") : t("editDescriptionLocked")}
        </SheetDescription>
      </SheetHeader>
      <form
        id="order-edit-form"
        onSubmit={onSubmit}
        noValidate
        className="flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          <ScheduleFields
            control={form.control}
            unitLabel={tUnits(order.unit)}
            wholePieces={wholePieces}
            priorityMode={priorityMode}
            computedPriority={order.computedPriority}
            quantityDisabled={!planning}
          />
          <PieceFields control={form.control} wholePieces={wholePieces} disabled={!planning} />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="order-edit-form" disabled={pending}>
          {pending ? t("submitting") : t("submitEdit")}
        </Button>
      </SheetFooter>
    </>
  );
}

export function CopyOrderSheet({
  open,
  onOpenChange,
  order,
  priorityMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail;
  priorityMode: PriorityMode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-xl">
        {open ? (
          <CopyOrderForm
            order={order}
            priorityMode={priorityMode}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CopyOrderForm({
  order,
  priorityMode,
  onDone,
}: {
  order: OrderDetail;
  priorityMode: PriorityMode;
  onDone: () => void;
}) {
  const t = useTranslations("orders.form");
  const tUnits = useTranslations("productUnits");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CopyOrderFormValues, unknown, CopyOrderInput>({
    resolver: zodResolver(copyOrderSchema),
    defaultValues: {
      quantity: formatDecimal(order.quantity),
      dueDate: "",
      priority: "",
      plannedStart: "",
      plannedEnd: "",
      notes: order.notes ?? "",
    },
  });
  const wholePieces = isWholeUnit(order.unit);

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    const values = form.getValues();
    if (!quantityFitsUnit(values.quantity.replace(",", "."), order.unit)) {
      form.setError("quantity", { type: "server", message: t("fieldErrors.quantityWhole") });
      return;
    }
    startTransition(async () => {
      const result = await copyOrderAction(order.id, values);
      if (result.ok) {
        toast.success(t("copiedToast", { number: order.orderNumber }));
        onDone();
        router.push(`/orders/${result.id}`);
        return;
      }
      applyResult(
        result,
        (field) => {
          if (
            field === "quantity" ||
            field === "dueDate" ||
            field === "priority" ||
            field === "plannedStart" ||
            field === "plannedEnd" ||
            field === "notes"
          ) {
            form.setError(field, { type: "server" });
          }
        },
        setFormError,
      );
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("copyTitle", { number: order.orderNumber })}</SheetTitle>
        <SheetDescription>{t("copyDescription")}</SheetDescription>
      </SheetHeader>
      <form
        id="order-copy-form"
        onSubmit={onSubmit}
        noValidate
        className="flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          <ScheduleFields
            control={form.control}
            unitLabel={tUnits(order.unit)}
            wholePieces={wholePieces}
            priorityMode={priorityMode}
            computedPriority={null}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="order-copy-form" disabled={pending}>
          {pending ? t("submitting") : t("submitCopy")}
        </Button>
      </SheetFooter>
    </>
  );
}
