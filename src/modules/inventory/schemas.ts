import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalDecimal, optionalText, optionalUuid, requiredText } from "@/lib/forms";
import {
  BASE_UNITS,
  baseUnitsForShape,
  PRICE_UNITS,
  SHAPE_DIMENSIONS,
  STOCK_SHAPES,
} from "./rules";

/** Database rule messages the actions show as their own errors. */
export const STOCK_ERRORS = [
  "negative_stock",
  "item_not_found",
  "location_not_found",
  "lot_not_found",
  "customer_not_found",
  "price_required",
  "price_unit_invalid",
  "invalid_line",
  "reason_required",
  "already_decided",
  "document_not_found",
  "module_disabled",
  "item_has_movements",
  "shelf_needs_warehouse",
] as const;
export type StockError = (typeof STOCK_ERRORS)[number];

const millimetres = optionalDecimal({ maxScale: 3, max: "100000", exclusiveMin: true });
const pieceSize = optionalDecimal({ maxScale: 1, max: "100000", exclusiveMin: true });

/** Optional whole number of pieces: "" → null; `signed` allows negatives (not 0). */
const pieceCount = (signed: boolean) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const pattern = signed ? /^-?\d{1,6}$/ : /^\d{1,6}$/;
      const parsed = pattern.test(value) ? Number(value) : NaN;
      if (!Number.isInteger(parsed) || parsed === 0) {
        ctx.addIssue({ code: "custom", message: "invalid pieces" });
        return z.NEVER;
      }
      return parsed;
    });

// ---------------------------------------------------------------------------
// Stock items
// ---------------------------------------------------------------------------

export const stockItemSchema = z
  .object({
    code: requiredText(40),
    name: requiredText(200),
    materialId: optionalUuid,
    shape: z.enum(STOCK_SHAPES),
    diameter: millimetres,
    width: millimetres,
    thickness: millimetres,
    profileLabel: optionalText(60),
    baseUnit: z.enum(BASE_UNITS),
    standardLength: pieceSize,
    standardWidth: pieceSize,
    massPerM: optionalDecimal({ maxScale: 4, max: "100000", exclusiveMin: true }),
    supplier: optionalText(200),
    /** In the display unit (m for length items). */
    minStock: optionalDecimal({ maxScale: 3, max: "1000000000" }),
    defaultLocationId: optionalUuid,
    notes: optionalText(2000),
  })
  .superRefine((item, ctx) => {
    const required = SHAPE_DIMENSIONS[item.shape];
    for (const dimension of ["diameter", "width", "thickness"] as const) {
      if ((item[dimension] !== null) !== required.includes(dimension)) {
        ctx.addIssue({ code: "custom", path: [dimension], message: "dimension" });
      }
    }
    if (
      item.shape === "tube" &&
      item.diameter &&
      item.thickness &&
      Number(item.thickness) * 2 >= Number(item.diameter)
    ) {
      ctx.addIssue({ code: "custom", path: ["thickness"], message: "wall" });
    }
    if (!baseUnitsForShape(item.shape).includes(item.baseUnit)) {
      ctx.addIssue({ code: "custom", path: ["baseUnit"], message: "unit" });
    }
    if (item.shape === "profile" && !item.profileLabel) {
      ctx.addIssue({ code: "custom", path: ["profileLabel"], message: "required" });
    }
    if (item.shape !== "profile" && item.profileLabel) {
      ctx.addIssue({ code: "custom", path: ["profileLabel"], message: "profile only" });
    }
    if (item.shape === "profile" && !item.massPerM) {
      ctx.addIssue({ code: "custom", path: ["massPerM"], message: "required" });
    }
    if (item.baseUnit !== "mm" && item.massPerM) {
      ctx.addIssue({ code: "custom", path: ["massPerM"], message: "length only" });
    }
    const sheet = item.shape === "sheet" || item.shape === "plate";
    if (item.baseUnit !== "mm" && !sheet && item.standardLength) {
      ctx.addIssue({ code: "custom", path: ["standardLength"], message: "length only" });
    }
    if (!sheet && item.standardWidth) {
      ctx.addIssue({ code: "custom", path: ["standardWidth"], message: "sheet only" });
    }
  });
export type StockItemFormValues = z.input<typeof stockItemSchema>;
export type StockItemInput = z.output<typeof stockItemSchema>;
export const STOCK_ITEM_FIELDS = [
  "code",
  "name",
  "materialId",
  "shape",
  "diameter",
  "width",
  "thickness",
  "profileLabel",
  "baseUnit",
  "standardLength",
  "standardWidth",
  "massPerM",
  "supplier",
  "minStock",
  "defaultLocationId",
  "notes",
] as const;
export type StockItemField = (typeof STOCK_ITEM_FIELDS)[number];
export type StockItemActionResult = ActionResult<StockItemField, "code_taken" | StockError>;

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export const LOCATION_KINDS = ["warehouse", "shelf", "machine"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const locationSchema = z
  .object({
    kind: z.enum(LOCATION_KINDS),
    parentId: optionalUuid,
    machineId: optionalUuid,
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._/-]{1,20}$/),
    name: requiredText(100),
  })
  .superRefine((location, ctx) => {
    if ((location.kind === "shelf") !== (location.parentId !== null)) {
      ctx.addIssue({ code: "custom", path: ["parentId"], message: "parent" });
    }
    if ((location.kind === "machine") !== (location.machineId !== null)) {
      ctx.addIssue({ code: "custom", path: ["machineId"], message: "machine" });
    }
  });
export type LocationFormValues = z.input<typeof locationSchema>;
export const LOCATION_FIELDS = ["kind", "parentId", "machineId", "code", "name"] as const;
export type LocationField = (typeof LOCATION_FIELDS)[number];
export type LocationActionResult = ActionResult<LocationField, "code_taken" | StockError>;

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const receiptLineSchema = z.object({
  itemId: z.uuid(),
  locationId: z.uuid(),
  pieces: pieceCount(false),
  length: pieceSize,
  width: pieceSize,
  quantity: optionalDecimal({ maxScale: 3, max: "1000000000", exclusiveMin: true }),
  heatNumber: optionalText(60),
  ownerCustomerId: optionalUuid,
  unitPrice: optionalDecimal({ maxScale: 4, max: "10000000" }),
  priceUnit: z.union([z.literal(""), z.enum(PRICE_UNITS)]).transform((value) => value || null),
  invoiceKg: optionalDecimal({ maxScale: 3, max: "10000000", exclusiveMin: true }),
});

export const receiptSchema = z
  .object({
    idempotencyKey: z.uuid(),
    documentDate: isoDate,
    supplier: optionalText(200),
    deliveryNote: optionalText(60),
    notes: optionalText(2000),
    pricesIncludeVat: z.boolean(),
    lines: z.array(receiptLineSchema).min(1).max(100),
  })
  .superRefine((receipt, ctx) => {
    receipt.lines.forEach((line, index) => {
      if (!line.ownerCustomerId && (line.unitPrice === null || line.priceUnit === null)) {
        ctx.addIssue({ code: "custom", path: ["lines", index, "unitPrice"], message: "price" });
      }
    });
  });
export type ReceiptFormValues = z.input<typeof receiptSchema>;
export type ReceiptInput = z.output<typeof receiptSchema>;
export const RECEIPT_FIELDS = [
  "documentDate",
  "supplier",
  "deliveryNote",
  "notes",
  "pricesIncludeVat",
  "lines",
] as const;
export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

export const transferSchema = z
  .object({
    idempotencyKey: z.uuid(),
    itemId: z.uuid(),
    lotId: z.uuid(),
    fromLocationId: z.uuid(),
    toLocationId: z.uuid(),
    length: pieceSize,
    width: pieceSize,
    pieces: pieceCount(false),
    quantity: optionalDecimal({ maxScale: 3, max: "1000000000", exclusiveMin: true }),
    notes: optionalText(2000),
  })
  .refine((t) => t.fromLocationId !== t.toLocationId, { path: ["toLocationId"] })
  .refine((t) => (t.pieces === null) !== (t.quantity === null), { path: ["pieces"] });
export type TransferFormValues = z.input<typeof transferSchema>;
export const TRANSFER_FIELDS = ["toLocationId", "pieces", "quantity", "notes"] as const;
export type TransferField = (typeof TRANSFER_FIELDS)[number];

export const adjustmentSchema = z
  .object({
    idempotencyKey: z.uuid(),
    reason: requiredText(500),
    post: z.boolean(),
    itemId: z.uuid(),
    lotId: optionalUuid,
    locationId: z.uuid(),
    length: pieceSize,
    width: pieceSize,
    pieces: pieceCount(true),
    quantity: optionalDecimal({ maxScale: 3, max: "1000000000", min: "-1000000000" }),
  })
  .refine((a) => (a.pieces === null) !== (a.quantity === null || a.quantity === "0"), {
    path: ["pieces"],
  })
  .refine((a) => a.lotId !== null || (a.pieces ?? Number(a.quantity ?? "0")) > 0, {
    path: ["lotId"],
  });
export type AdjustmentFormValues = z.input<typeof adjustmentSchema>;
export const ADJUSTMENT_FIELDS = [
  "reason",
  "lotId",
  "locationId",
  "length",
  "width",
  "pieces",
  "quantity",
] as const;
export type AdjustmentField = (typeof ADJUSTMENT_FIELDS)[number];

export const decisionSchema = z
  .object({
    documentId: z.uuid(),
    approve: z.boolean(),
    note: optionalText(500),
  })
  .refine((d) => d.approve || d.note !== null, { path: ["note"] });

export type MoveActionResult<TField extends string> = ActionResult<TField, StockError>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const inventorySettingsSchema = z.object({
  remnantMinLengthMm: optionalDecimal({ maxScale: 0, max: "20000", exclusiveMin: true }).refine(
    (value) => value !== null,
  ),
  vatRate: optionalDecimal({ maxScale: 2, max: "100" }).refine((value) => value !== null),
  pricesIncludeVat: z.boolean(),
});
export type InventorySettingsFormValues = z.input<typeof inventorySettingsSchema>;
export const INVENTORY_SETTINGS_FIELDS = [
  "remnantMinLengthMm",
  "vatRate",
  "pricesIncludeVat",
] as const;
export type InventorySettingsField = (typeof INVENTORY_SETTINGS_FIELDS)[number];

// ---------------------------------------------------------------------------
// Certificates (3.1) in the private stock-certificates bucket
// ---------------------------------------------------------------------------

export const CERTIFICATES_BUCKET = "stock-certificates";
export const CERTIFICATE_CONTENT_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type CertificateContentType = keyof typeof CERTIFICATE_CONTENT_TYPES;
export const CERTIFICATE_MAX_BYTES = 20 * 1024 * 1024;

export const certificateMetaSchema = z.object({
  lotId: z.uuid(),
  fileName: requiredText(200),
  contentType: z.enum(
    Object.keys(CERTIFICATE_CONTENT_TYPES) as [CertificateContentType, ...CertificateContentType[]],
  ),
  size: z.number().int().min(1).max(CERTIFICATE_MAX_BYTES),
});
export type CertificateError = StockError | "upload_failed" | "file_type" | "too_large";
export type CertificateActionResult = ActionResult<never, CertificateError>;
