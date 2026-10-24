"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch, type FieldError as FormFieldError } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { formatDecimal } from "@/lib/decimal";
import type { CatalogOption } from "@/modules/catalogs/queries";
import { createProductAction, updateProductAction } from "@/modules/products/actions";
import type { ProductDetail, ProductRevision } from "@/modules/products/queries";
import {
  BLANK_GEOMETRIES,
  createProductSchema,
  PRODUCT_UNITS,
  type CreateProductInput,
  type ProductActionResult,
  type ProductField,
  type ProductFormValues,
} from "@/modules/products/schemas";

export type ProductCatalogs = { types: CatalogOption[]; shapes: CatalogOption[] };

type FormError = Extract<ProductActionResult, { ok: false }>["error"];
type Editing = { product: ProductDetail; revision: ProductRevision };

const EMPTY: ProductFormValues = {
  partNumber: "",
  name: "",
  customerName: "",
  productTypeId: "",
  unit: "pcs",
  revision: "A",
  drawingNumber: "",
  description: "",
  materialGrade: "",
  materialShapeId: "",
  blankGeometry: "",
  blankDiameter: "",
  blankWidth: "",
  blankHeight: "",
  blankThickness: "",
  cutLength: "",
  kerf: "",
  netMass: "",
};

function toFormValues({ product, revision }: Editing): ProductFormValues {
  return {
    partNumber: product.partNumber,
    name: product.name,
    customerName: product.customerName ?? "",
    productTypeId: product.type?.id ?? "",
    unit: product.unit,
    revision: revision.revision,
    drawingNumber: revision.drawingNumber ?? "",
    description: revision.description ?? "",
    materialGrade: revision.materialGrade ?? "",
    materialShapeId: revision.materialShape?.id ?? "",
    blankGeometry: revision.blankGeometry ?? "",
    blankDiameter: formatDecimal(revision.blankDiameter),
    blankWidth: formatDecimal(revision.blankWidth),
    blankHeight: formatDecimal(revision.blankHeight),
    blankThickness: formatDecimal(revision.blankThickness),
    cutLength: formatDecimal(revision.cutLength),
    kerf: formatDecimal(revision.kerf),
    netMass: formatDecimal(revision.netMass),
  };
}

/** Catalog options plus the current value when it has been archived meanwhile. */
function withCurrent(options: CatalogOption[], current: { id: string; name: string } | null) {
  return current && !options.some((option) => option.id === current.id)
    ? [...options, { ...current, archived: true }]
    : options;
}

export function CreateProductButton({ catalogs }: { catalogs: ProductCatalogs }) {
  const t = useTranslations("products.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("open")}
      </Button>
      <ProductSheet open={open} onOpenChange={setOpen} editing={null} catalogs={catalogs} />
    </>
  );
}

/** Create (editing null) or edit form for a product and its current revision. */
export function ProductSheet({
  open,
  onOpenChange,
  editing,
  catalogs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Editing | null;
  catalogs: ProductCatalogs;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-xl">
        {open ? (
          <ProductForm
            key={editing?.revision.id ?? "new"}
            editing={editing}
            catalogs={catalogs}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const DIMENSIONS = {
  round: ["blankDiameter", "blankWidth", "blankHeight"],
  prismatic: ["blankWidth", "blankHeight", "blankThickness"],
} as const;

function ProductForm({
  editing,
  catalogs,
  onDone,
}: {
  editing: Editing | null;
  catalogs: ProductCatalogs;
  onDone: () => void;
}) {
  const t = useTranslations("products.form");
  const tUnit = useTranslations("productUnits");
  const tGeometry = useTranslations("blankGeometry");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ProductFormValues, unknown, CreateProductInput>({
    // Editing keeps the revision label (disabled field); the server ignores it.
    resolver: zodResolver(createProductSchema),
    defaultValues: editing ? toFormValues(editing) : EMPTY,
  });
  const geometry = useWatch({ control: form.control, name: "blankGeometry" });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const raw = form.getValues();
      const result = editing
        ? await updateProductAction(editing.product.id, raw)
        : await createProductAction(raw);
      if (result.ok) {
        const code = values.partNumber;
        toast.success(editing ? t("updatedToast", { code }) : t("createdToast", { code }));
        onDone();
        if (!editing) router.push(`/products/${result.id}`);
        return;
      }
      if (result.error === "part_number_taken" || result.error === "revision_taken") {
        const field = result.error === "part_number_taken" ? "partNumber" : "revision";
        form.setError(field, { type: "server", message: t(`errors.${result.error}`) });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const errorFor = (name: ProductField, error: FormFieldError | undefined) =>
    error?.type === "server" && error.message ? error.message : t(`fieldErrors.${name}`);

  const textField = (
    name: "partNumber" | "name" | "customerName" | "revision" | "drawingNumber" | "materialGrade",
    options: { hint?: string; disabled?: boolean } = {},
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`product-${name}`}>{t(name)}</FieldLabel>
          <Input
            {...field}
            id={`product-${name}`}
            autoComplete="off"
            disabled={options.disabled}
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>{errorFor(name, fieldState.error)}</FieldError>
          ) : options.hint ? (
            <FieldDescription>{options.hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );

  const numberField = (
    name:
      | "blankDiameter"
      | "blankWidth"
      | "blankHeight"
      | "blankThickness"
      | "cutLength"
      | "kerf"
      | "netMass",
    unit: string,
  ) => (
    <Controller
      key={name}
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`product-${name}`}>
            {t(name)} <span className="text-muted-foreground">({unit})</span>
          </FieldLabel>
          <Input
            {...field}
            id={`product-${name}`}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? <FieldError>{errorFor(name, fieldState.error)}</FieldError> : null}
        </Field>
      )}
    />
  );

  const selectField = (
    name: "productTypeId" | "materialShapeId",
    none: string,
    options: (CatalogOption & { archived?: boolean })[],
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`product-${name}`}>{t(name)}</FieldLabel>
          <NativeSelect
            {...field}
            id={`product-${name}`}
            className="w-full"
            aria-invalid={fieldState.invalid || undefined}
          >
            <NativeSelectOption value="">{none}</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.archived ? t("archivedOption", { name: option.name }) : option.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {fieldState.invalid ? <FieldError>{t(`fieldErrors.${name}`)}</FieldError> : null}
        </Field>
      )}
    />
  );

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {editing
            ? t("editTitle", {
                code: editing.product.partNumber,
                revision: editing.revision.revision,
              })
            : t("createTitle")}
        </SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <form id="product-form" onSubmit={onSubmit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          <FieldSet>
            <FieldLegend>{t("sections.product")}</FieldLegend>
            <FieldGroup>
              {textField("partNumber", { hint: t("partNumberHint") })}
              {textField("name")}
              {textField("customerName", { hint: t("customerNameHint") })}
              <div className="grid gap-4 sm:grid-cols-2">
                {selectField(
                  "productTypeId",
                  t("productTypeNone"),
                  withCurrent(catalogs.types, editing?.product.type ?? null),
                )}
                <Controller
                  name="unit"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="product-unit">{t("unit")}</FieldLabel>
                      <NativeSelect {...field} id="product-unit" className="w-full">
                        {PRODUCT_UNITS.map((unit) => (
                          <NativeSelectOption key={unit} value={unit}>
                            {tUnit(unit)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                />
              </div>
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend>{t("sections.drawing")}</FieldLegend>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                {textField("drawingNumber")}
                {textField("revision", {
                  disabled: editing !== null,
                  hint: editing ? t("revisionLockedHint") : t("revisionHint"),
                })}
              </div>
              <Controller
                name="description"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="product-description">{t("descriptionField")}</FieldLabel>
                    <Textarea
                      {...field}
                      id="product-description"
                      rows={3}
                      aria-invalid={fieldState.invalid || undefined}
                    />
                    {fieldState.invalid ? (
                      <FieldError>{t("fieldErrors.description")}</FieldError>
                    ) : null}
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend>{t("sections.material")}</FieldLegend>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                {textField("materialGrade", { hint: t("materialGradeHint") })}
                {selectField(
                  "materialShapeId",
                  t("materialShapeNone"),
                  withCurrent(catalogs.shapes, editing?.revision.materialShape ?? null),
                )}
              </div>
              <Controller
                name="blankGeometry"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="product-blankGeometry">{t("blankGeometry")}</FieldLabel>
                    <NativeSelect
                      {...field}
                      id="product-blankGeometry"
                      className="w-full"
                      onChange={(event) => {
                        field.onChange(event);
                        // Clear dimensions that the new geometry does not use.
                        const next = event.target.value as ProductFormValues["blankGeometry"];
                        const used: readonly string[] = next ? DIMENSIONS[next] : [];
                        for (const name of [
                          "blankDiameter",
                          "blankWidth",
                          "blankHeight",
                          "blankThickness",
                        ] as const) {
                          if (!used.includes(name)) form.setValue(name, "");
                        }
                      }}
                    >
                      <NativeSelectOption value="">{t("blankGeometryNone")}</NativeSelectOption>
                      {BLANK_GEOMETRIES.map((value) => (
                        <NativeSelectOption key={value} value={value}>
                          {tGeometry(value)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>{t("blankGeometryHint")}</FieldDescription>
                  </Field>
                )}
              />
              {geometry ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  {DIMENSIONS[geometry].map((name) => numberField(name, "mm"))}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-3">
                {numberField("cutLength", "mm")}
                {numberField("kerf", "mm")}
                {numberField("netMass", "kg")}
              </div>
            </FieldGroup>
          </FieldSet>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="product-form" disabled={pending}>
          {pending ? t("submitting") : editing ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
