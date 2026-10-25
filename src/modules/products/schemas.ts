import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalDecimal, optionalText, optionalUuid, requiredText } from "@/lib/forms";
import { compareDecimals, multiplyDecimal } from "@/lib/decimal";
import { minutesToSeconds } from "./rules";

// Must match the CHECKs in the products migrations (20261024140000, 20261024160000).
export const PRODUCT_UNITS = ["pcs", "kg", "m", "m2", "set"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Raw piece shape; decides which dimensions apply (see BLANK_DIMENSIONS). */
export const BLANK_GEOMETRIES = ["round", "tube", "rectangular", "hexagon", "other"] as const;
export type BlankGeometry = (typeof BLANK_GEOMETRIES)[number];

export const BLANK_DIMENSION_FIELDS = ["blankDiameter", "blankWidth", "blankThickness"] as const;
export type BlankDimensionField = (typeof BLANK_DIMENSION_FIELDS)[number];

/** Dimensions used per shape (the length of the piece is cutLength for every shape). */
export const BLANK_DIMENSIONS: Record<BlankGeometry, readonly BlankDimensionField[]> = {
  round: ["blankDiameter"],
  tube: ["blankDiameter", "blankThickness"],
  rectangular: ["blankWidth", "blankThickness"],
  hexagon: ["blankDiameter"],
  other: [],
};

export const INSPECTION_PLANS = ["between", "final", "none"] as const;
export type InspectionPlan = (typeof INSPECTION_PLANS)[number];

export const INSPECTION_MODES = ["automatic", "manual", "custom"] as const;
export type InspectionMode = (typeof INSPECTION_MODES)[number];

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

/** Optional label of a first revision (only when the drawing carries one). */
const optionalRevisionLabel = z
  .string()
  .trim()
  .max(10)
  .regex(/^[A-Za-z0-9.-]*$/)
  .transform((value) => value.toUpperCase() || null);

const millimetres = optionalDecimal({ maxScale: 3, max: "9999999", exclusiveMin: true });

const productFields = {
  partNumber: requiredText(100),
  name: requiredText(200),
  customerId: optionalUuid,
  productTypeId: optionalUuid,
  unit: z.enum(PRODUCT_UNITS),
  inspectionPlan: z.enum(INSPECTION_PLANS),
  drawingNumber: optionalText(100),
  description: optionalText(2000),
  materialId: optionalUuid,
  blankGeometry: z
    .union([z.literal(""), z.enum(BLANK_GEOMETRIES)])
    .transform((value) => value || null),
  blankDiameter: millimetres,
  blankWidth: millimetres,
  blankThickness: millimetres,
  cutLength: millimetres,
  kerf: optionalDecimal({ maxScale: 3, max: "99999" }),
  netMass: optionalDecimal({ maxScale: 4, max: "99999999", exclusiveMin: true }),
};

type BlankFields = {
  blankGeometry: BlankGeometry | null;
  blankDiameter: string | null;
  blankWidth: string | null;
  blankThickness: string | null;
};

/**
 * Only the dimensions of the chosen shape may be set; a tube wall must be
 * thinner than half the outer diameter. Mirrors product_revisions_blank_check.
 */
function checkBlank(value: BlankFields, ctx: z.RefinementCtx) {
  const used = BLANK_DIMENSIONS[value.blankGeometry ?? "other"];
  for (const field of BLANK_DIMENSION_FIELDS) {
    if (value[field] !== null && !used.includes(field)) {
      ctx.addIssue({ code: "custom", path: [field], message: "not used for this shape" });
    }
  }
  if (
    value.blankGeometry === "tube" &&
    value.blankDiameter !== null &&
    value.blankThickness !== null &&
    compareDecimals(multiplyDecimal(value.blankThickness, "2"), value.blankDiameter) >= 0
  ) {
    ctx.addIssue({ code: "custom", path: ["blankThickness"], message: "wall too thick" });
  }
}

export const productSchema = z.object(productFields).superRefine(checkBlank);
export const createProductSchema = z
  .object({ ...productFields, revision: optionalRevisionLabel })
  .superRefine(checkBlank);

export type ProductInput = z.infer<typeof productSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ProductFormValues = z.input<typeof createProductSchema>;

export const PRODUCT_FIELDS = [
  "partNumber",
  "name",
  "customerId",
  "productTypeId",
  "unit",
  "inspectionPlan",
  "revision",
  "drawingNumber",
  "description",
  "materialId",
  "blankGeometry",
  "blankDiameter",
  "blankWidth",
  "blankThickness",
  "cutLength",
  "kerf",
  "netMass",
] as const;

export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type ProductError =
  | "part_number_taken"
  | "revision_taken"
  | "invalid_reference"
  | "not_current"
  | "inspection_type_missing";
export type ProductActionResult = ActionResult<ProductField, ProductError>;

/** JSON arguments of create_product / update_product. */
export function toProductRpcArgs(input: ProductInput, revision?: string | null) {
  return {
    product: {
      part_number: input.partNumber,
      name: input.name,
      customer_id: input.customerId,
      product_type_id: input.productTypeId,
      unit: input.unit,
      inspection_plan: input.inspectionPlan,
    },
    revision: {
      ...(revision === undefined ? {} : { revision }),
      drawing_number: input.drawingNumber,
      description: input.description,
      material_id: input.materialId,
      blank_geometry: input.blankGeometry,
      blank_diameter_mm: input.blankDiameter,
      blank_width_mm: input.blankWidth,
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
  revision: optionalRevisionLabel,
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
  "invalid_reference" | "external_rules" | "not_current" | "inspection_type_missing";
export type OperationActionResult = ActionResult<OperationField, OperationError>;

/**
 * JSON for save_product_operation. External operations carry no machine,
 * setup or cycle time; internal ones no external company. Decimals stay strings.
 */
export function toOperationRow(input: OperationInput, external: boolean) {
  return {
    operation_type_id: input.operationTypeId,
    description: input.description,
    machine_type_id: external ? null : input.resource.machineTypeId,
    machine_id: external ? null : input.resource.machineId,
    external_company: external ? input.externalCompany : null,
    setup_time_min: external ? null : input.setupTime,
    cycle_time_s: external ? null : input.cycleTimeSeconds,
    notes: input.notes,
  };
}

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------
export const operationTypeSchema = z
  .object({
    name: requiredText(100),
    code: z
      .string()
      .trim()
      .transform((value) => value.toLocaleUpperCase("bs"))
      .pipe(z.string().regex(/^[A-Z0-9ČĆĐŠŽ-]{1,10}$/u)),
    isExternal: z.boolean(),
    isInspection: z.boolean(),
    isCutting: z.boolean(),
  })
  .refine((value) => !(value.isExternal && value.isInspection), {
    path: ["isInspection"],
    message: "an inspection is done in-house",
  })
  .refine((value) => !(value.isCutting && (value.isExternal || value.isInspection)), {
    path: ["isCutting"],
    message: "cutting is an in-house production step",
  });
export type OperationTypeFormValues = z.input<typeof operationTypeSchema>;
export const OPERATION_TYPE_FIELDS = [
  "name",
  "code",
  "isExternal",
  "isInspection",
  "isCutting",
] as const;
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
export const productionSettingsSchema = z.object({
  cycleTimeUnit: cycleTimeUnitSchema,
  inspectionMode: z.enum(INSPECTION_MODES),
});
export type ProductionSettingsFormValues = z.input<typeof productionSettingsSchema>;
