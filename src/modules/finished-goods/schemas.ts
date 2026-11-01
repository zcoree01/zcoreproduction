import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalDecimal, optionalText, optionalUuid } from "@/lib/forms";
import { deliveryTemplateLayoutSchema, isValidDeliveryNumberTemplate } from "./rules";

/** Database rule messages the actions show as their own errors. */
export const FINISHED_ERRORS = [
  "order_not_found",
  "order_not_open",
  "invalid_line",
  "more_than_good",
  "customer_not_found",
  "template_not_found",
  "not_in_stock",
  "already_cancelled",
  "delivery_note_not_found",
  "reason_required",
  "module_disabled",
] as const;
export type FinishedError = (typeof FINISHED_ERRORS)[number];
export type FinishedActionResult<TField extends string = never> = ActionResult<
  TField,
  FinishedError | "name_taken" | "upload_failed" | "file_type"
>;

const positiveQuantity = optionalDecimal({
  maxScale: 3,
  max: "99999999999",
  exclusiveMin: true,
}).refine((value) => value !== null);

export const receiveSchema = z.object({
  idempotencyKey: z.uuid(),
  orderId: z.uuid(),
  quantity: positiveQuantity,
});

export const deliveryLineSchema = z.object({
  orderId: z.uuid(),
  quantity: positiveQuantity,
  customerPosition: optionalText(60),
});

export const deliveryNoteSchema = z.object({
  idempotencyKey: z.uuid(),
  customerId: z.uuid(),
  templateId: optionalUuid,
  issuedOn: z.iso.date(),
  notes: optionalText(2000),
  lines: z.array(deliveryLineSchema).min(1).max(500),
});
export type DeliveryNoteInput = z.output<typeof deliveryNoteSchema>;
export const DELIVERY_NOTE_FIELDS = [
  "customerId",
  "templateId",
  "issuedOn",
  "notes",
  "lines",
] as const;
export type DeliveryNoteField = (typeof DELIVERY_NOTE_FIELDS)[number];

export const cancelNoteSchema = z.object({
  noteId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean(),
  layout: deliveryTemplateLayoutSchema,
});
export type TemplateInput = z.output<typeof templateSchema>;
export const TEMPLATE_FIELDS = ["name", "isDefault", "layout"] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

export const numberSettingsSchema = z.object({
  template: z.string().trim().refine(isValidDeliveryNumberTemplate),
  digits: z.number().int().min(1).max(6),
});
export const NUMBER_SETTINGS_FIELDS = ["template", "digits"] as const;
export type NumberSettingsField = (typeof NUMBER_SETTINGS_FIELDS)[number];

export const LOGO_CONTENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
} as const;
export type LogoContentType = keyof typeof LOGO_CONTENT_TYPES;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const ORGANIZATION_FILES_BUCKET = "organization-files";

export const logoMetaSchema = z.object({
  contentType: z.enum(Object.keys(LOGO_CONTENT_TYPES) as [LogoContentType, ...LogoContentType[]]),
  size: z.number().int().min(1).max(LOGO_MAX_BYTES),
});
