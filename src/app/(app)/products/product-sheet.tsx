"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, ScaleIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Controller, useForm, useWatch, type FieldError as FormFieldError } from "react-hook-form";
import { toast } from "sonner";
import { SearchSelect } from "@/components/shared/search-select";
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
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import type { CatalogOption } from "@/modules/catalogs/queries";
import type { CustomerOption } from "@/modules/customers/queries";
import type { MaterialOption } from "@/modules/materials/schemas";
import {
  createProductAction,
  getCurrentRevisionIdAction,
  updateProductAction,
} from "@/modules/products/actions";
import type { ProductDetail, ProductRevision } from "@/modules/products/queries";
import { blankWeightKg, lengthWithKerf, type InspectionModeValue } from "@/modules/products/rules";
import {
  BLANK_DIMENSION_FIELDS,
  BLANK_DIMENSIONS,
  BLANK_GEOMETRIES,
  createProductSchema,
  INSPECTION_PLANS,
  PRODUCT_UNITS,
  type CreateProductInput,
  type ProductActionResult,
  type ProductField,
  type ProductFormValues,
} from "@/modules/products/schemas";
import { ACCEPT_ATTACHMENTS, uploadAttachment } from "./upload";

export type ProductFormOptions = {
  types: CatalogOption[];
  customers: CustomerOption[];
  materials: MaterialOption[];
  inspectionMode: InspectionModeValue;
};

type FormError = Extract<ProductActionResult, { ok: false }>["error"];
type Editing = { product: ProductDetail; revision: ProductRevision };

/** Files picked while creating a product; uploaded once the product exists. */
type PendingFile = { key: string; file: File; kind: "main_drawing" | "image" | "other" };

function emptyValues(mode: InspectionModeValue): ProductFormValues {
  return {
    partNumber: "",
    name: "",
    customerId: "",
    productTypeId: "",
    unit: "pcs",
    // custom: the user answers below (default yes); other modes are decided on the server.
    inspectionPlan: mode === "manual" ? "none" : "between",
    revision: "",
    drawingNumber: "",
    description: "",
    materialId: "",
    blankGeometry: "",
    blankDiameter: "",
    blankWidth: "",
    blankThickness: "",
    cutLength: "",
    kerf: "",
    netMass: "",
  };
}

function toFormValues({ product, revision }: Editing): ProductFormValues {
  return {
    partNumber: product.partNumber,
    name: product.name,
    customerId: product.customer?.id ?? "",
    productTypeId: product.type?.id ?? "",
    unit: product.unit,
    inspectionPlan: product.inspectionPlan,
    revision: revision.revision ?? "",
    drawingNumber: revision.drawingNumber ?? "",
    description: revision.description ?? "",
    materialId: revision.material?.id ?? "",
    blankGeometry: revision.blankGeometry ?? "",
    blankDiameter: formatDecimal(revision.blankDiameter),
    blankWidth: formatDecimal(revision.blankWidth),
    blankThickness: formatDecimal(revision.blankThickness),
    cutLength: formatDecimal(revision.cutLength),
    kerf: formatDecimal(revision.kerf),
    netMass: formatDecimal(revision.netMass),
  };
}

/** Options plus the current value when it has been archived meanwhile. */
function withCurrent<T extends { id: string }>(options: T[], current: T | null): T[] {
  return current && !options.some((option) => option.id === current.id)
    ? [...options, current]
    : options;
}

export function CreateProductButton({ options }: { options: ProductFormOptions }) {
  const t = useTranslations("products.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("open")}
      </Button>
      <ProductSheet open={open} onOpenChange={setOpen} editing={null} options={options} />
    </>
  );
}

/** Create (editing null) or edit form for a product and its current revision. */
export function ProductSheet({
  open,
  onOpenChange,
  editing,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Editing | null;
  options: ProductFormOptions;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-xl">
        {open ? (
          <ProductForm
            key={editing?.revision.id ?? "new"}
            editing={editing}
            options={options}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ProductForm({
  editing,
  options,
  onDone,
}: {
  editing: Editing | null;
  options: ProductFormOptions;
  onDone: () => void;
}) {
  const t = useTranslations("products.form");
  const tUnit = useTranslations("productUnits");
  const tGeometry = useTranslations("blankGeometry");
  const tPlan = useTranslations("inspectionPlans");
  const tKind = useTranslations("products.attachments.kinds");
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<ProductFormValues, unknown, CreateProductInput>({
    // Editing keeps the revision label (disabled field); the server ignores it.
    resolver: zodResolver(createProductSchema),
    defaultValues: editing ? toFormValues(editing) : emptyValues(options.inspectionMode),
  });
  const [geometry, materialId, diameter, width, thickness, length, kerf] = useWatch({
    control: form.control,
    name: [
      "blankGeometry",
      "materialId",
      "blankDiameter",
      "blankWidth",
      "blankThickness",
      "cutLength",
      "kerf",
    ],
  });
  const used = BLANK_DIMENSIONS[geometry || "other"];
  const materials = withCurrent(
    options.materials,
    editing?.revision.material
      ? { ...editing.revision.material, density: editing.revision.material.density }
      : null,
  );
  const material = materials.find((option) => option.id === materialId) ?? null;
  const decimal = (value: string | undefined) => parseDecimal(value ?? "", 3);
  const weight = blankWeightKg(
    {
      geometry: geometry || null,
      diameter: decimal(diameter),
      width: decimal(width),
      thickness: decimal(thickness),
      length: decimal(length),
    },
    material?.density ?? null,
  );
  const consumption = lengthWithKerf(decimal(length), decimal(kerf));

  const uploadPending = async (productId: string) => {
    if (files.length === 0) return;
    const revision = await getCurrentRevisionIdAction(productId);
    if (!revision.ok) return toast.error(t("uploadFailed", { count: files.length }));
    let failed = 0;
    for (const pendingFile of files) {
      const result = await uploadAttachment({
        revisionId: revision.id,
        kind: pendingFile.kind,
        title: "",
        mainDrawingId: "",
        operationId: "",
        file: pendingFile.file,
      });
      if (!result.ok) failed += 1;
    }
    if (failed > 0) toast.error(t("uploadFailed", { count: failed }));
  };

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const raw = form.getValues();
      const result = editing
        ? await updateProductAction(editing.product.id, raw)
        : await createProductAction(raw);
      if (result.ok) {
        const code = values.partNumber;
        if (!editing) await uploadPending(result.id);
        toast.success(editing ? t("updatedToast", { code }) : t("createdToast", { code }));
        onDone();
        if (editing) router.refresh();
        else router.push(`/products/${result.id}`);
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
    name: "partNumber" | "name" | "revision" | "drawingNumber",
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
    name: "blankDiameter" | "blankWidth" | "blankThickness" | "cutLength" | "kerf" | "netMass",
    unit: string,
    label?: string,
  ) => (
    <Controller
      key={name}
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`product-${name}`}>
            {label ?? t(name)} <span className="text-muted-foreground">({unit})</span>
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

  // Labels depend on the shape: Ø vs. outer Ø vs. across flats, thickness vs. wall.
  const dimensionLabel = (name: (typeof BLANK_DIMENSION_FIELDS)[number]) => {
    if (name === "blankDiameter") {
      return geometry === "tube"
        ? t("outerDiameter")
        : geometry === "hexagon"
          ? t("acrossFlats")
          : t("blankDiameter");
    }
    if (name === "blankThickness" && geometry === "tube") return t("wallThickness");
    return t(name);
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {editing ? t("editTitle", { code: editing.product.partNumber }) : t("createTitle")}
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
              <Controller
                name="customerId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="product-customerId">{t("customerId")}</FieldLabel>
                    <SearchSelect
                      id="product-customerId"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t("customerPlaceholder")}
                      invalid={fieldState.invalid}
                      options={withCurrent(
                        options.customers,
                        editing?.product.customer ?? null,
                      ).map((customer) => ({ value: customer.id, label: customer.name }))}
                    />
                    {fieldState.invalid ? (
                      <FieldError>{t("fieldErrors.customerId")}</FieldError>
                    ) : (
                      <FieldDescription>{t("customerHint")}</FieldDescription>
                    )}
                  </Field>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  name="productTypeId"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="product-productTypeId">{t("productTypeId")}</FieldLabel>
                      <NativeSelect {...field} id="product-productTypeId" className="w-full">
                        <NativeSelectOption value="">{t("productTypeNone")}</NativeSelectOption>
                        {withCurrent(options.types, editing?.product.type ?? null).map((type) => (
                          <NativeSelectOption key={type.id} value={type.id}>
                            {type.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                />
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
            <FieldLegend>{t("sections.inspection")}</FieldLegend>
            {editing ? (
              <Controller
                name="inspectionPlan"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="product-inspectionPlan">{t("inspectionPlan")}</FieldLabel>
                    <NativeSelect {...field} id="product-inspectionPlan" className="w-full">
                      {INSPECTION_PLANS.map((plan) => (
                        <NativeSelectOption key={plan} value={plan}>
                          {tPlan(plan)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>{t("inspectionPlanHint")}</FieldDescription>
                  </Field>
                )}
              />
            ) : options.inspectionMode === "custom" ? (
              <Controller
                name="inspectionPlan"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="product-inspectBetween">{t("inspectBetween")}</FieldLabel>
                    <NativeSelect
                      id="product-inspectBetween"
                      className="w-full"
                      value={field.value === "between" ? "yes" : "no"}
                      onChange={(event) =>
                        field.onChange(event.target.value === "yes" ? "between" : "final")
                      }
                    >
                      <NativeSelectOption value="yes">{t("inspectBetweenYes")}</NativeSelectOption>
                      <NativeSelectOption value="no">{t("inspectBetweenNo")}</NativeSelectOption>
                    </NativeSelect>
                    <FieldDescription>{t("inspectBetweenHint")}</FieldDescription>
                  </Field>
                )}
              />
            ) : (
              <FieldDescription>{t(`inspectionMode.${options.inspectionMode}`)}</FieldDescription>
            )}
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
              <Controller
                name="materialId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="product-materialId">{t("materialId")}</FieldLabel>
                    <SearchSelect
                      id="product-materialId"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t("materialPlaceholder")}
                      invalid={fieldState.invalid}
                      options={materials.map((option) => ({
                        value: option.id,
                        label: option.designation,
                        hint: option.density
                          ? t("materialHint", {
                              group: option.groupName,
                              density: formatDecimal(option.density),
                            })
                          : option.groupName,
                      }))}
                    />
                    {fieldState.invalid ? (
                      <FieldError>{t("fieldErrors.materialId")}</FieldError>
                    ) : (
                      <FieldDescription>{t("materialHelp")}</FieldDescription>
                    )}
                  </Field>
                )}
              />
              <Controller
                name="blankGeometry"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="product-blankGeometry">{t("blankGeometry")}</FieldLabel>
                    <NativeSelect
                      {...field}
                      id="product-blankGeometry"
                      className="w-full"
                      onChange={(event) => {
                        field.onChange(event);
                        // Clear dimensions that the new shape does not use.
                        const next = event.target.value as ProductFormValues["blankGeometry"];
                        const keep = BLANK_DIMENSIONS[next || "other"];
                        for (const name of BLANK_DIMENSION_FIELDS) {
                          if (!keep.includes(name)) form.setValue(name, "");
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
                  </Field>
                )}
              />
              {used.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {used.map((name) => numberField(name, "mm", dimensionLabel(name)))}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-3">
                {numberField("cutLength", "mm")}
                {numberField("kerf", "mm")}
                {numberField("netMass", "kg")}
              </div>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
                <ScaleIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                <div className="flex flex-col gap-1">
                  <span>
                    {weight
                      ? t("blankWeight", { weight: formatDecimal(weight) })
                      : t("blankWeightMissing")}
                  </span>
                  {consumption ? (
                    <span className="text-muted-foreground">
                      {t("consumption", { length: formatDecimal(consumption) })}
                    </span>
                  ) : null}
                </div>
              </div>
            </FieldGroup>
          </FieldSet>

          {editing ? null : (
            <FieldSet>
              <FieldLegend>{t("sections.files")}</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="product-files">{t("files")}</FieldLabel>
                  <Input
                    ref={fileInput}
                    id="product-files"
                    type="file"
                    multiple
                    accept={ACCEPT_ATTACHMENTS}
                    onChange={(event) => {
                      const picked = Array.from(event.target.files ?? []);
                      setFiles((current) => [
                        ...current,
                        ...picked.map((file, index) => ({
                          key: `${Date.now()}-${index}-${file.name}`,
                          file,
                          kind:
                            current.length === 0 && index === 0 && file.type === "application/pdf"
                              ? ("main_drawing" as const)
                              : file.type.startsWith("image/")
                                ? ("image" as const)
                                : ("other" as const),
                        })),
                      ]);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                  />
                  <FieldDescription>{t("filesHint")}</FieldDescription>
                </Field>
                {files.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {files.map((pendingFile) => (
                      <li
                        key={pendingFile.key}
                        className="flex items-center gap-2 rounded-md border p-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">{pendingFile.file.name}</span>
                        <NativeSelect
                          size="sm"
                          aria-label={t("fileKind", { name: pendingFile.file.name })}
                          value={pendingFile.kind}
                          onChange={(event) => {
                            const kind = event.target.value as PendingFile["kind"];
                            setFiles((current) =>
                              current.map((item) =>
                                item.key === pendingFile.key ? { ...item, kind } : item,
                              ),
                            );
                          }}
                        >
                          {(["main_drawing", "image", "other"] as const).map((kind) => (
                            <NativeSelectOption key={kind} value={kind}>
                              {tKind(kind)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("removeFile", { name: pendingFile.file.name })}
                          onClick={() =>
                            setFiles((current) =>
                              current.filter((item) => item.key !== pendingFile.key),
                            )
                          }
                        >
                          <XIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </FieldGroup>
            </FieldSet>
          )}
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
