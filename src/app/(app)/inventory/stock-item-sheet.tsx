"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { toast } from "sonner";
import { SearchSelect } from "@/components/shared/search-select";
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
import { divideDecimal, formatDecimal, parseDecimal } from "@/lib/decimal";
import type { MaterialOption } from "@/modules/materials/schemas";
import { saveStockItemAction } from "@/modules/inventory/actions";
import type { StockItem, StockLocation } from "@/modules/inventory/queries";
import {
  baseUnitsForShape,
  displayUnit,
  kgPerMetre,
  kgPerUnit,
  SHAPE_DIMENSIONS,
  STOCK_SHAPES,
  suggestedItemName,
  toDisplayQuantity,
  type StockShape,
} from "@/modules/inventory/rules";
import {
  stockItemSchema,
  type StockItemField,
  type StockItemFormValues,
  type StockItemInput,
} from "@/modules/inventory/schemas";

type Values = StockItemFormValues;

function defaults(item: StockItem | null): Values {
  return {
    code: item?.code ?? "",
    name: item?.name ?? "",
    materialId: item?.materialId ?? "",
    shape: item?.shape ?? "round_bar",
    diameter: formatDecimal(item?.diameter),
    width: formatDecimal(item?.width),
    thickness: formatDecimal(item?.thickness),
    profileLabel: item?.profileLabel ?? "",
    baseUnit: item?.baseUnit ?? "mm",
    standardLength: formatDecimal(item?.standardLength),
    standardWidth: formatDecimal(item?.standardWidth),
    massPerM: formatDecimal(item?.massPerM),
    supplier: item?.supplier ?? "",
    minStock: item?.minStock ? formatDecimal(toDisplayQuantity(item.baseUnit, item.minStock)) : "",
    defaultLocationId: item?.defaultLocationId ?? "",
    notes: item?.notes ?? "",
  };
}

export function StockItemSheet({
  open,
  onOpenChange,
  item,
  locked,
  materials,
  locations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: StockItem | null;
  /** The item has movements: shape, dimensions, grade and kg/m cannot change. */
  locked: boolean;
  materials: MaterialOption[];
  locations: StockLocation[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {open ? (
          <StockItemForm
            item={item}
            locked={locked}
            materials={materials}
            locations={locations}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function StockItemForm({
  item,
  locked,
  materials,
  locations,
  onDone,
}: {
  item: StockItem | null;
  locked: boolean;
  materials: MaterialOption[];
  locations: StockLocation[];
  onDone: () => void;
}) {
  const t = useTranslations("inventory");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values, unknown, StockItemInput>({
    resolver: zodResolver(stockItemSchema),
    defaultValues: defaults(item),
  });
  const values = useWatch({ control: form.control });
  const shape = (values.shape ?? "round_bar") as StockShape;
  const dimensions = SHAPE_DIMENSIONS[shape];
  const units = baseUnitsForShape(shape);
  const baseUnit = units.includes(values.baseUnit ?? "mm") ? (values.baseUnit ?? "mm") : units[0];
  const material = materials.find((m) => m.id === values.materialId) ?? null;
  const sheet = shape === "sheet" || shape === "plate";

  const decimal = (value: string | undefined) => (value ? parseDecimal(value, 4) : null);
  const geometry = {
    shape,
    baseUnit: baseUnit ?? "mm",
    diameter: dimensions.includes("diameter") ? decimal(values.diameter) : null,
    width: dimensions.includes("width") ? decimal(values.width) : null,
    thickness: dimensions.includes("thickness") ? decimal(values.thickness) : null,
    massPerM: lengthOnlyMass(baseUnit, decimal(values.massPerM)),
  };
  const suggestion = suggestedItemName(
    { ...geometry, profileLabel: values.profileLabel?.trim() || null },
    material?.designation ?? null,
  );
  const conversion = (() => {
    if (geometry.baseUnit === "kg") return t("itemForm.conversionKg");
    if (geometry.baseUnit === "pcs") return t("itemForm.conversionPcs");
    if (geometry.baseUnit === "mm") {
      const perM = kgPerMetre(geometry, material?.density ?? null);
      return perM ? t("itemForm.conversionM", { value: formatDecimal(perM) }) : null;
    }
    const perM2 = kgPerUnit(geometry, material?.density ?? null);
    return perM2
      ? t("itemForm.conversionM2", { value: formatDecimal(divideDecimal(perM2, "1", 3)) })
      : null;
  })();

  const changeShape = (next: StockShape) => {
    form.setValue("shape", next);
    const allowed = baseUnitsForShape(next);
    if (!allowed.includes(form.getValues("baseUnit")))
      form.setValue("baseUnit", allowed[0] ?? "kg");
    for (const dimension of ["diameter", "width", "thickness"] as const) {
      if (!SHAPE_DIMENSIONS[next].includes(dimension)) form.setValue(dimension, "");
    }
    if (next !== "profile") form.setValue("profileLabel", "");
  };

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const raw = form.getValues();
      const result = await saveStockItemAction(item?.id ?? null, {
        ...raw,
        baseUnit,
        massPerM: baseUnit === "mm" ? raw.massPerM : "",
        standardLength: baseUnit === "mm" || sheet ? raw.standardLength : "",
        standardWidth: sheet ? raw.standardWidth : "",
      });
      if (result.ok) {
        toast.success(t("itemForm.saved"));
        onDone();
        if (!item) router.push(`/inventory/${result.id}`);
      } else if (result.error === "code_taken") {
        form.setError("code", { type: "server", message: t("errors.code_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(t(`errors.${result.error}`));
      }
    });
  });

  const dimensionLabel: Record<"diameter" | "width" | "thickness", string> = {
    diameter:
      shape === "hex_bar"
        ? t("itemForm.diameterHex")
        : shape === "tube"
          ? t("itemForm.diameterTube")
          : t("itemForm.diameter"),
    width: shape === "square_bar" ? t("itemForm.widthSquare") : t("itemForm.width"),
    thickness: shape === "tube" ? t("itemForm.thicknessTube") : t("itemForm.thickness"),
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{item ? t("itemForm.titleEdit") : t("itemForm.titleNew")}</SheetTitle>
        <SheetDescription>{t("itemForm.description")}</SheetDescription>
      </SheetHeader>
      <form
        id="stock-item-form"
        onSubmit={onSubmit}
        noValidate
        className="flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {locked ? (
            <Alert>
              <AlertDescription>{t("itemForm.locked")}</AlertDescription>
            </Alert>
          ) : null}

          <Controller
            name="materialId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="stock-item-material">{t("itemForm.material")}</FieldLabel>
                <SearchSelect
                  id="stock-item-material"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  disabled={locked}
                  invalid={fieldState.invalid}
                  placeholder={t("itemForm.materialNone")}
                  options={[
                    { value: "", label: t("itemForm.materialNone") },
                    ...materials.map((m) => ({
                      value: m.id,
                      label: m.designation,
                      hint: m.groupName,
                    })),
                  ]}
                />
              </Field>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              name="shape"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="stock-item-shape">{t("itemForm.shape")}</FieldLabel>
                  <NativeSelect
                    id="stock-item-shape"
                    className="w-full"
                    value={field.value}
                    disabled={locked}
                    onChange={(event) => changeShape(event.target.value as StockShape)}
                  >
                    {STOCK_SHAPES.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {t(`shapes.${value}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            />
            <Controller
              name="baseUnit"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="stock-item-unit">{t("itemForm.baseUnit")}</FieldLabel>
                  <NativeSelect
                    {...field}
                    value={baseUnit}
                    id="stock-item-unit"
                    className="w-full"
                    disabled={locked || units.length === 1}
                  >
                    {units.map((unit) => (
                      <NativeSelectOption key={unit} value={unit}>
                        {t(`units.${unit}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            />
          </div>

          {dimensions.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {dimensions.map((dimension) => (
                <TextField
                  key={dimension}
                  control={form.control}
                  name={dimension}
                  label={dimensionLabel[dimension]}
                  inputMode="decimal"
                  disabled={locked}
                />
              ))}
            </div>
          ) : null}

          {shape === "profile" ? (
            <TextField
              control={form.control}
              name="profileLabel"
              label={t("itemForm.profileLabel")}
              placeholder={t("itemForm.profileLabelPlaceholder")}
              disabled={locked}
            />
          ) : null}

          {baseUnit === "mm" ? (
            <TextField
              control={form.control}
              name="massPerM"
              label={t("itemForm.massPerM")}
              hint={t("itemForm.massPerMHint")}
              inputMode="decimal"
              disabled={locked}
            />
          ) : null}

          <p className="text-sm text-muted-foreground" aria-live="polite">
            {conversion ?? t("itemForm.conversionUnknown")}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="code" label={t("itemForm.code")} />
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="stock-item-name">{t("itemForm.name")}</FieldLabel>
                  <Input
                    {...field}
                    id="stock-item-name"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid || undefined}
                  />
                  {fieldState.invalid ? (
                    <FieldError>{t("errors.invalid")}</FieldError>
                  ) : suggestion && suggestion !== field.value ? (
                    <FieldDescription>
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => form.setValue("name", suggestion)}
                      >
                        {t("itemForm.suggest", { name: suggestion })}
                      </button>
                    </FieldDescription>
                  ) : null}
                </Field>
              )}
            />
          </div>

          {baseUnit === "mm" || sheet ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="standardLength"
                label={sheet ? t("itemForm.standardLengthSheet") : t("itemForm.standardLength")}
                hint={t("itemForm.standardLengthHint")}
                inputMode="decimal"
              />
              {sheet ? (
                <TextField
                  control={form.control}
                  name="standardWidth"
                  label={t("itemForm.standardWidth")}
                  inputMode="decimal"
                />
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={form.control}
              name="minStock"
              label={t("itemForm.minStock", {
                unit: t(`displayUnits.${displayUnit(baseUnit ?? "mm")}`),
              })}
              inputMode="decimal"
            />
            <Controller
              name="defaultLocationId"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="stock-item-location">
                    {t("itemForm.defaultLocation")}
                  </FieldLabel>
                  <NativeSelect {...field} id="stock-item-location" className="w-full">
                    <NativeSelectOption value="">{t("itemForm.none")}</NativeSelectOption>
                    {locations
                      .filter((l) => !l.archived || l.id === field.value)
                      .map((l) => (
                        <NativeSelectOption key={l.id} value={l.id}>
                          {l.label}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </Field>
              )}
            />
          </div>

          <TextField control={form.control} name="supplier" label={t("itemForm.supplier")} />
          <Controller
            name="notes"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="stock-item-notes">{t("itemForm.notes")}</FieldLabel>
                <Textarea {...field} id="stock-item-notes" rows={3} />
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="stock-item-form" disabled={pending}>
          {t("itemForm.save")}
        </Button>
      </SheetFooter>
    </>
  );
}

/** kg per metre only applies to length items. */
function lengthOnlyMass(unit: string | undefined, value: string | null) {
  return unit === "mm" ? value : null;
}

function TextField({
  control,
  name,
  label,
  hint,
  placeholder,
  inputMode,
  disabled,
}: {
  control: Control<Values, unknown, StockItemInput>;
  name: Exclude<StockItemField, "shape" | "baseUnit">;
  label: string;
  hint?: string;
  placeholder?: string;
  inputMode?: "decimal";
  disabled?: boolean;
}) {
  const t = useTranslations("inventory");
  const id = `stock-item-${name}`;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...field}
            value={field.value ?? ""}
            id={id}
            autoComplete="off"
            inputMode={inputMode}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>{t("errors.invalid")}</FieldError>
          ) : hint ? (
            <FieldDescription>{hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );
}
