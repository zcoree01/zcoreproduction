import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalDecimal, optionalText, optionalUuid, requiredText } from "@/lib/forms";
import { numericParam } from "@/lib/supabase/numeric";
import { minutesToSeconds } from "./rules";

// Must match the CHECKs in supabase/migrations/20261024140000_products.sql.
export const PRODUCT_UNITS = ["pcs", "kg", "m", "m2", "set"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const BLANK_GEOMETRIES = ["round", "prismatic"] as const;
export type BlankGeometry = (typeof BLANK_GEOMETRIES)[number];

export const CYCLE_TIME_UNITS = ["min", "s"] as const;
export type CycleTimeUnit = (typeof CYCLE_TIME_UNITS)[number];
export const cycleTimeUnitSchema = z.enum(CYCLE_TIME_UNITS);

export const ATTACHMENT_KINDS = ["main_drawing", "machine_drawing", "image", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_CONTENT_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type AttachmentContentType = keyof typeof ATTACHMENT_CONTENT_TYPES;
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const PRODUCT_FILES_BUCKET = "product-files";

const contentTypeSchema = z.enum(
  Object.keys(ATTACHMENT_CONTENT_TYPES) as [AttachmentContentType, ...AttachmentContentType[]],
);

// ---------------------------------------------------------------------------
// Product + revision form
// ---------------------------------------------------------------------------

/** Revision label: letters, digits, "." and "-", stored upper-case (a → A). */
export const revisionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z0-9.-]+$/)
  .transform((value) => value.toUpperCase());

const millimetres = optionalDecimal({ maxScale: 3, max: "9999999", exclusiveMin: true });

const productFields = {
  partNumber: requiredText(100),
  name: requiredText(200),
  customerName: optionalText(200),
  productTypeId: optionalUuid,
  unit: z.enum(PRODUCT_UNITS),
  drawingNumber: optionalText(100),
  description: optionalText(2000),
  materialGrade: optionalText(100),
  materialShapeId: optionalUuid,
  blankGeometry: z
    .union([z.literal(""), z.enum(BLANK_GEOMETRIES)])
    .transform((value) => value || null),
  blankDiameter: millimetres,
  blankWidth: millimetres,
  blankHeight: millimetres,
  blankThickness: millimetres,
  cutLength: millimetres,
  kerf: optionalDecimal({ maxScale: 3, max: "99999" }),
  netMass: optionalDecimal({ maxScale: 4, max: "99999999", exclusiveMin: true }),
};

type BlankFields = {
  blankGeometry: BlankGeometry | null;
  blankDiameter: string | null;
  blankWidth: string | null;
  blankHeight: string | null;
  blankThickness: string | null;
};

/**
 * Round blanks have a diameter (plus width and height), prismatic ones width,
 * height and thickness. Mirrors product_revisions_blank_check.
 */
function checkBlank(value: BlankFields, ctx: z.RefinementCtx) {
  const misplaced = (field: keyof BlankFields) =>
    ctx.addIssue({ code: "custom", path: [field], message: "not used for this geometry" });
  if (value.blankGeometry === null) {
    for (const field of ["blankDiameter", "blankWidth", "blankHeight", "blankThickness"] as const) {
      if (value[field] !== null) misplaced(field);
    }
  } else if (value.blankGeometry === "round") {
    if (value.blankThickness !== null) misplaced("blankThickness");
  } else if (value.blankDiameter !== null) {
    misplaced("blankDiameter");
  }
}

export const productSchema = z.object(productFields).superRefine(checkBlank);
export const createProductSchema = z
  .object({ ...productFields, revision: revisionLabelSchema })
  .superRefine(checkBlank);

export type ProductInput = z.infer<typeof productSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ProductFormValues = z.input<typeof createProductSchema>;

export const PRODUCT_FIELDS = [
  "partNumber",
  "name",
  "customerName",
  "productTypeId",
  "unit",
  "revision",
  "drawingNumber",
  "description",
  "materialGrade",
  "materialShapeId",
  "blankGeometry",
  "blankDiameter",
  "blankWidth",
  "blankHeight",
  "blankThickness",
  "cutLength",
  "kerf",
  "netMass",
] as const;

export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type ProductError =
  "part_number_taken" | "revision_taken" | "invalid_reference" | "not_current";
export type ProductActionResult = ActionResult<ProductField, ProductError>;

/** JSON arguments of create_product / update_product. */
export function toProductRpcArgs(input: ProductInput, revision?: string) {
  return {
    product: {
      part_number: input.partNumber,
      name: input.name,
      customer_name: input.customerName,
      product_type_id: input.productTypeId,
      unit: input.unit,
    },
    revision: {
      ...(revision === undefined ? {} : { revision }),
      drawing_number: input.drawingNumber,
      description: input.description,
      material_grade: input.materialGrade,
      material_shape_id: input.materialShapeId,
      blank_geometry: input.blankGeometry,
      blank_diameter_mm: input.blankDiameter,
      blank_width_mm: input.blankWidth,
      blank_height_mm: input.blankHeight,
      blank_thickness_mm: input.blankThickness,
      cut_length_mm: input.cutLength,
      kerf_mm: input.kerf,
      net_mass_kg: input.netMass,
    },
  };
}

// ---------------------------------------------------------------------------
// New revision / copy
// ---------------------------------------------------------------------------
export const newRevisionSchema = z.object({ revision: revisionLabelSchema });
export type NewRevisionFormValues = z.input<typeof newRevisionSchema>;

export const copyProductSchema = z.object({
  partNumber: requiredText(100),
  name: requiredText(200),
  revision: revisionLabelSchema,
});
export type CopyProductFormValues = z.input<typeof copyProductSchema>;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Machine select value: "" (none), "type:<uuid>" or "machine:<uuid>". */
const resourceSchema = z.string().transform((value, ctx) => {
  if (value === "") return { machineTypeId: null, machineId: null };
  const match = /^(type|machine):(.+)$/.exec(value);
  const id = z.uuid().safeParse(match?.[2]);
  if (!match || !id.success) {
    ctx.addIssue({ code: "custom", message: "invalid resource" });
    return z.NEVER;
  }
  return match[1] === "type"
    ? { machineTypeId: id.data, machineId: null }
    : { machineTypeId: null, machineId: id.data };
});

export const operationSchema = z.object({
  sequence: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/)
    .transform(Number)
    .refine((value) => value >= 1),
  operationTypeId: z.uuid(),
  description: optionalText(200),
  resource: resourceSchema,
  externalCompany: optionalText(200),
  setupTime: optionalDecimal({ maxScale: 2, max: "99999" }),
  cycleTime: z.string(),
  cycleUnit: cycleTimeUnitSchema,
  notes: optionalText(2000),
});

/** Cycle time in seconds from the entered value and unit, or null / invalid. */
export function parseCycleTime(value: string, unit: CycleTimeUnit): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = optionalDecimal({
    maxScale: unit === "min" ? 3 : 2,
    max: unit === "min" ? "99999" : "5999940",
    exclusiveMin: true,
  }).safeParse(trimmed);
  if (!parsed.success || parsed.data === null) return undefined;
  return unit === "min" ? minutesToSeconds(parsed.data) : parsed.data;
}

export const validOperationSchema = operationSchema.transform((value, ctx) => {
  const cycleTimeSeconds = parseCycleTime(value.cycleTime, value.cycleUnit);
  if (cycleTimeSeconds === undefined) {
    ctx.addIssue({ code: "custom", path: ["cycleTime"], message: "invalid cycle time" });
    return z.NEVER;
  }
  return { ...value, cycleTimeSeconds };
});

export type OperationInput = z.infer<typeof validOperationSchema>;
export type OperationFormValues = z.input<typeof operationSchema>;

export const OPERATION_FIELDS = [
  "sequence",
  "operationTypeId",
  "description",
  "resource",
  "externalCompany",
  "setupTime",
  "cycleTime",
  "cycleUnit",
  "notes",
] as const;
export type OperationField = (typeof OPERATION_FIELDS)[number];
export type OperationError =
  "sequence_taken" | "invalid_reference" | "external_rules" | "not_current";
export type OperationActionResult = ActionResult<OperationField, OperationError>;

/**
 * Row for public.product_operations. External operations carry no machine,
 * setup or cycle time; internal ones no external company.
 */
export function toOperationRow(input: OperationInput, external: boolean) {
  return {
    sequence: input.sequence,
    operation_type_id: input.operationTypeId,
    description: input.description,
    machine_type_id: external ? null : input.resource.machineTypeId,
    machine_id: external ? null : input.resource.machineId,
    external_company: external ? input.externalCompany : null,
    setup_time_min: numericParam(external ? null : input.setupTime),
    cycle_time_s: numericParam(external ? null : input.cycleTimeSeconds),
    notes: input.notes,
  };
}

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------
export const operationTypeSchema = z.object({
  name: requiredText(100),
  code: z
    .string()
    .trim()
    .transform((value) => value.toLocaleUpperCase("bs"))
    .pipe(z.string().regex(/^[A-Z0-9ČĆĐŠŽ-]{1,10}$/u)),
  isExternal: z.boolean(),
});
export type OperationTypeFormValues = z.input<typeof operationTypeSchema>;
export const OPERATION_TYPE_FIELDS = ["name", "code", "isExternal"] as const;
export type OperationTypeField = (typeof OPERATION_TYPE_FIELDS)[number];
export type OperationTypeActionResult = ActionResult<
  OperationTypeField,
  "name_taken" | "code_taken"
>;

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
export const attachmentMetaSchema = z
  .object({
    revisionId: z.uuid(),
    kind: z.enum(ATTACHMENT_KINDS),
    title: optionalText(200),
    mainDrawingId: optionalUuid,
    operationId: optionalUuid,
    fileName: z.string().trim().min(1).max(255),
    contentType: contentTypeSchema,
    size: z.number().int().min(1).max(ATTACHMENT_MAX_BYTES),
  })
  .superRefine((value, ctx) => {
    const machineDrawing = value.kind === "machine_drawing";
    if (machineDrawing !== (value.mainDrawingId !== null)) {
      ctx.addIssue({ code: "custom", path: ["mainDrawingId"], message: "main drawing" });
    }
    if (!machineDrawing && value.operationId !== null) {
      ctx.addIssue({ code: "custom", path: ["operationId"], message: "operation" });
    }
  });
export type AttachmentMeta = z.infer<typeof attachmentMetaSchema>;
export type AttachmentMetaInput = z.input<typeof attachmentMetaSchema>;

export const ATTACHMENT_FIELDS = [
  "kind",
  "title",
  "mainDrawingId",
  "operationId",
  "fileName",
  "contentType",
  "size",
] as const;
export type AttachmentField = (typeof ATTACHMENT_FIELDS)[number];
export type AttachmentError = "not_current" | "invalid_reference" | "upload_failed";
export type AttachmentActionResult = ActionResult<AttachmentField, AttachmentError>;

// ---------------------------------------------------------------------------
// Production settings (organizations.settings)
// ---------------------------------------------------------------------------
export const productionSettingsSchema = z.object({ cycleTimeUnit: cycleTimeUnitSchema });
export type ProductionSettingsFormValues = z.input<typeof productionSettingsSchema>;
