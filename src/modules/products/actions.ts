"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, invalidFields, violates, type DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nullableParam } from "@/lib/supabase/numeric";
import type { Json } from "@/lib/supabase/types";
import {
  attachmentStoragePath,
  inspectionModeFromSettings,
  inspectionPlanFor,
  isProductStoragePath,
} from "./rules";
import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_FIELDS,
  attachmentMetaSchema,
  copyProductSchema,
  createProductSchema,
  newRevisionSchema,
  OPERATION_FIELDS,
  OPERATION_TYPE_FIELDS,
  operationTypeSchema,
  PRODUCT_FIELDS,
  PRODUCT_FILES_BUCKET,
  productionSettingsSchema,
  productSchema,
  toOperationRow,
  toProductRpcArgs,
  validOperationSchema,
  type AttachmentActionResult,
  type AttachmentField,
  type AttachmentError,
  type OperationActionResult,
  type OperationError,
  type OperationField,
  type OperationTypeActionResult,
  type OperationTypeField,
  type ProductActionResult,
  type ProductError,
  type ProductField,
} from "./schemas";

const failProduct = actionFail<ProductField, ProductError>;
const failOperation = actionFail<OperationField, OperationError>;
const failAttachment = actionFail<AttachmentField, AttachmentError>;
const failOperationType = actionFail<OperationTypeField, "name_taken" | "code_taken">;

function revalidateProductScreens() {
  revalidatePath("/products", "layout");
}

/** Postgres/PostgREST error → shared result kind. */
function errorKind(error: DbError) {
  if ((error?.message ?? "").includes("inspection_type_missing")) {
    return "inspection_type_missing" as const;
  }
  switch (error?.code) {
    case "23505":
      return "unique" as const;
    case "23503":
      return "foreign_key" as const;
    case "23514":
      return "check" as const;
    case "55000":
      return "not_current" as const;
    case "42501":
      return "denied" as const;
    case "P0002":
    case "PGRST116":
      return "not_found" as const;
    default:
      return "other" as const;
  }
}

function mapProductError(error: DbError): ProductActionResult {
  if (violates(error, "products_part_number_key")) {
    return failProduct("part_number_taken", ["partNumber"]);
  }
  if (violates(error, "product_revisions_revision_key")) {
    return failProduct("revision_taken", ["revision"]);
  }
  switch (errorKind(error)) {
    case "inspection_type_missing":
      return failProduct("inspection_type_missing");
    case "foreign_key":
      return failProduct("invalid_reference", ["customerId", "productTypeId", "materialId"]);
    case "check":
      return failProduct("invalid");
    case "not_current":
      return failProduct("not_current");
    case "denied":
      return failProduct("denied");
    case "not_found":
      return failProduct("not_found");
    default:
      console.error("product write failed", error);
      return failProduct("unexpected");
  }
}

async function managerOrg(): Promise<string | null> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  return (await permitAction(organizationId, "products.manage")) ? organizationId : null;
}

async function readSettings(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  return data.settings;
}

// ---------------------------------------------------------------------------
// Products and revisions
// ---------------------------------------------------------------------------

/** Product with its first revision. `input` comes from the client: re-validated. */
export async function createProductAction(input: unknown): Promise<ProductActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failProduct("denied");

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) return failProduct("invalid", invalidFields(parsed.error, PRODUCT_FIELDS));

  const mode = inspectionModeFromSettings(await readSettings(organizationId));
  const inspectionPlan = inspectionPlanFor(mode, parsed.data.inspectionPlan === "between");
  const args = toProductRpcArgs({ ...parsed.data, inspectionPlan }, parsed.data.revision);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_product", {
    p_org_id: organizationId,
    p_product: args.product as Json,
    p_revision: args.revision as Json,
  });
  if (error) return mapProductError(error);

  revalidateProductScreens();
  return { ok: true, id: data };
}

/** Product fields and the fields of its current revision. */
export async function updateProductAction(
  id: unknown,
  input: unknown,
): Promise<ProductActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failProduct("denied");

  const parsedId = z.uuid().safeParse(id);
  const parsed = productSchema.safeParse(input);
  if (!parsedId.success) return failProduct("invalid");
  if (!parsed.success) return failProduct("invalid", invalidFields(parsed.error, PRODUCT_FIELDS));

  const args = toProductRpcArgs(parsed.data);
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_product", {
    p_product_id: parsedId.data,
    p_product: args.product as Json,
    p_revision: args.revision as Json,
  });
  if (error) return mapProductError(error);

  revalidateProductScreens();
  return { ok: true, id: parsedId.data };
}

/** Archive (hide from lists) or restore a product with all its revisions. */
export async function setProductArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<ProductActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failProduct("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return failProduct("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return mapProductError(error);
  if (data.length === 0) return failProduct("not_found");

  revalidateProductScreens();
  return { ok: true, id: parsed.data.id };
}

/**
 * New revision of a product, copied (data, operations, attachments) from
 * `sourceRevisionId` or the current revision; it becomes the current one.
 * Returns the new revision id.
 */
export async function createRevisionAction(
  productId: unknown,
  input: unknown,
  sourceRevisionId: unknown = null,
): Promise<ProductActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failProduct("denied");

  const ids = z
    .object({ productId: z.uuid(), sourceRevisionId: z.uuid().nullable() })
    .safeParse({ productId, sourceRevisionId });
  const parsed = newRevisionSchema.safeParse(input);
  if (!ids.success) return failProduct("invalid");
  if (!parsed.success) return failProduct("invalid", ["revision"]);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_product_revision", {
    p_product_id: ids.data.productId,
    p_revision: parsed.data.revision,
    p_source_revision_id: ids.data.sourceRevisionId ?? undefined,
  });
  if (error) return mapProductError(error);

  revalidateProductScreens();
  return { ok: true, id: data };
}

/** New product (own part number) from a revision; returns the new product id. */
export async function copyProductAction(
  sourceRevisionId: unknown,
  input: unknown,
): Promise<ProductActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failProduct("denied");

  const parsedId = z.uuid().safeParse(sourceRevisionId);
  const parsed = copyProductSchema.safeParse(input);
  if (!parsedId.success) return failProduct("invalid");
  if (!parsed.success) return failProduct("invalid", invalidFields(parsed.error, PRODUCT_FIELDS));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_product", {
    p_source_revision_id: parsedId.data,
    p_part_number: parsed.data.partNumber,
    p_name: parsed.data.name,
    // "" = no label (copy_product stores it as null).
    p_revision: parsed.data.revision ?? "",
  });
  if (error) return mapProductError(error);

  revalidateProductScreens();
  return { ok: true, id: data };
}

/** Current revision of a product (e.g. to upload files right after creating it). */
export async function getCurrentRevisionIdAction(
  productId: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: "invalid" | "not_found" }> {
  const member = await requireMember();
  const parsed = z.uuid().safeParse(productId);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_revisions")
    .select("id")
    .eq("organization_id", member.organization.id)
    .eq("product_id", parsed.data)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  return data ? { ok: true, id: data.id } : { ok: false, error: "not_found" };
}

/** Makes an older revision the current one again. */
export async function setCurrentRevisionAction(revisionId: unknown): Promise<ProductActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failProduct("denied");

  const parsed = z.uuid().safeParse(revisionId);
  if (!parsed.success) return failProduct("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_current_revision", { p_revision_id: parsed.data });
  if (error) return mapProductError(error);

  revalidateProductScreens();
  return { ok: true, id: parsed.data };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
function mapOperationError(error: DbError): OperationActionResult {
  switch (errorKind(error)) {
    case "inspection_type_missing":
      return failOperation("inspection_type_missing");
    case "foreign_key":
      return failOperation("invalid_reference", ["operationTypeId", "resource"]);
    case "check":
      return failOperation("external_rules");
    case "not_current":
      return failOperation("not_current");
    case "denied":
      return failOperation("denied");
    case "not_found":
      return failOperation("not_found");
    default:
      console.error("operation write failed", error);
      return failOperation("unexpected");
  }
}

/**
 * Creates (operationId null, appended at the end) or updates an operation.
 * The database re-places generated inspections afterwards.
 */
export async function saveOperationAction(
  revisionId: unknown,
  operationId: unknown,
  input: unknown,
): Promise<OperationActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failOperation("denied");

  const ids = z
    .object({ revisionId: z.uuid(), operationId: z.uuid().nullable() })
    .safeParse({ revisionId, operationId });
  const parsed = validOperationSchema.safeParse(input);
  if (!ids.success) return failOperation("invalid");
  if (!parsed.success) {
    return failOperation("invalid", invalidFields(parsed.error, OPERATION_FIELDS));
  }

  const supabase = await createClient();
  const type = await supabase
    .from("operation_types")
    .select("is_external")
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.operationTypeId)
    .maybeSingle();
  if (type.error) return mapOperationError(type.error);
  if (!type.data) return failOperation("invalid_reference", ["operationTypeId"]);

  const { data, error } = await supabase.rpc("save_product_operation", {
    p_revision_id: ids.data.revisionId,
    p_operation_id: nullableParam(ids.data.operationId),
    p_operation: toOperationRow(parsed.data, type.data.is_external) as Json,
  });
  if (error) return mapOperationError(error);

  revalidateProductScreens();
  return { ok: true, id: data };
}

export async function setOperationArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<OperationActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failOperation("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return failOperation("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_operation_archived", {
    p_operation_id: parsed.data.id,
    p_archived: parsed.data.archived,
  });
  if (error) return mapOperationError(error);

  revalidateProductScreens();
  return { ok: true, id: parsed.data.id };
}

/** New order of the manual operations (drag & drop or the arrow buttons). */
export async function reorderOperationsAction(
  revisionId: unknown,
  operationIds: unknown,
): Promise<OperationActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failOperation("denied");

  const parsed = z
    .object({ revisionId: z.uuid(), operationIds: z.array(z.uuid()).max(500) })
    .safeParse({ revisionId, operationIds });
  if (!parsed.success) return failOperation("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_product_operations", {
    p_revision_id: parsed.data.revisionId,
    p_operation_ids: parsed.data.operationIds,
  });
  // 22023: the routing changed meanwhile (another user); the page reloads.
  if (error?.code === "22023") return failOperation("not_found");
  if (error) return mapOperationError(error);

  revalidateProductScreens();
  return { ok: true, id: parsed.data.revisionId };
}

// ---------------------------------------------------------------------------
// Attachments: prepare (signed upload URL) → browser upload → register
// ---------------------------------------------------------------------------
type UploadFailure = Extract<AttachmentActionResult, { ok: false }>;
type UploadTicket = { ok: true; path: string; token: string } | UploadFailure;

function failTicket(error: UploadFailure["error"], fields: AttachmentField[] = []): UploadFailure {
  return { ok: false, error, fields };
}

/** Current revision of a non-archived product in this organization, or null. */
async function editableRevision(organizationId: string, revisionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_revisions")
    .select("product_id, is_current, product:products!inner(archived_at)")
    .eq("organization_id", organizationId)
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { state: "missing" as const };
  if (!data.is_current || data.product.archived_at !== null) return { state: "locked" as const };
  return { state: "ok" as const, productId: data.product_id };
}

/**
 * Validates the file (type, size, links) and returns a one-time upload URL
 * for a path chosen here: <organization>/<product>/<uuid>.<ext>.
 */
export async function prepareAttachmentUploadAction(input: unknown): Promise<UploadTicket> {
  const organizationId = await managerOrg();
  if (!organizationId) return failTicket("denied");

  const parsed = attachmentMetaSchema.safeParse(input);
  if (!parsed.success) {
    return failTicket("invalid", invalidFields(parsed.error, ATTACHMENT_FIELDS));
  }

  const revision = await editableRevision(organizationId, parsed.data.revisionId);
  if (revision.state === "missing") return failTicket("not_found");
  if (revision.state === "locked") return failTicket("not_current");

  const path = attachmentStoragePath(
    organizationId,
    revision.productId,
    randomUUID(),
    ATTACHMENT_CONTENT_TYPES[parsed.data.contentType],
  );
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(PRODUCT_FILES_BUCKET)
    .createSignedUploadUrl(path);
  if (error) {
    console.error("signed upload url failed", error);
    return failTicket("upload_failed");
  }
  return { ok: true, path: data.path, token: data.token };
}

/** Records an uploaded file; size and type are read back from Storage. */
export async function registerAttachmentAction(
  input: unknown,
  path: unknown,
): Promise<AttachmentActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failAttachment("denied");

  const parsed = attachmentMetaSchema.safeParse(input);
  const parsedPath = z.string().max(500).safeParse(path);
  if (!parsed.success || !parsedPath.success) return failAttachment("invalid");

  const revision = await editableRevision(organizationId, parsed.data.revisionId);
  if (revision.state === "missing") return failAttachment("not_found");
  if (revision.state === "locked") return failAttachment("not_current");
  if (!isProductStoragePath(parsedPath.data, organizationId, revision.productId)) {
    return failAttachment("invalid");
  }

  const supabase = await createClient();
  const info = await supabase.storage.from(PRODUCT_FILES_BUCKET).info(parsedPath.data);
  if (info.error || !info.data.size) return failAttachment("upload_failed");
  const contentType = attachmentMetaSchema.shape.contentType.safeParse(info.data.contentType);
  if (!contentType.success) return failAttachment("invalid", ["contentType"]);

  const { data, error } = await supabase
    .from("product_attachments")
    .insert({
      organization_id: organizationId,
      revision_id: parsed.data.revisionId,
      kind: parsed.data.kind,
      main_drawing_id: parsed.data.mainDrawingId,
      operation_id: parsed.data.operationId,
      title: parsed.data.title,
      file_name: parsed.data.fileName,
      storage_path: parsedPath.data,
      content_type: contentType.data,
      size_bytes: info.data.size,
    })
    .select("id")
    .single();
  if (error) {
    // Registered already (double submit): same revision + path.
    if (errorKind(error) === "unique") {
      const existing = await supabase
        .from("product_attachments")
        .select("id")
        .eq("revision_id", parsed.data.revisionId)
        .eq("storage_path", parsedPath.data)
        .single();
      if (!existing.error) return { ok: true, id: existing.data.id };
    }
    switch (errorKind(error)) {
      case "foreign_key":
      case "check":
        return failAttachment("invalid_reference", ["mainDrawingId", "operationId"]);
      case "not_current":
        return failAttachment("not_current");
      case "denied":
        return failAttachment("denied");
      default:
        console.error("attachment insert failed", error);
        return failAttachment("unexpected");
    }
  }

  revalidateProductScreens();
  return { ok: true, id: data.id };
}

export async function setAttachmentArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<AttachmentActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failAttachment("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return failAttachment("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_attachments")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    if (errorKind(error) === "not_current") return failAttachment("not_current");
    if (errorKind(error) === "check") return failAttachment("invalid_reference");
    console.error("attachment archive failed", error);
    return failAttachment("unexpected");
  }
  if (data.length === 0) return failAttachment("not_found");

  revalidateProductScreens();
  return { ok: true, id: parsed.data.id };
}

/** Short-lived download URL for an attachment (products.read via RLS). */
export async function getAttachmentUrlAction(
  id: unknown,
): Promise<
  { ok: true; url: string } | { ok: false; error: "invalid" | "not_found" | "unexpected" }
> {
  const member = await requireMember();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_attachments")
    .select("storage_path")
    .eq("organization_id", member.organization.id)
    .eq("id", parsed.data)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "not_found" };

  const signed = await supabase.storage
    .from(PRODUCT_FILES_BUCKET)
    .createSignedUrl(data.storage_path, 300);
  if (signed.error) {
    console.error("signed url failed", signed.error);
    return { ok: false, error: "unexpected" };
  }
  return { ok: true, url: signed.data.signedUrl };
}

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------
function mapOperationTypeError(error: DbError): OperationTypeActionResult {
  if (violates(error, "operation_types_name_key")) return failOperationType("name_taken", ["name"]);
  if (violates(error, "operation_types_code_key")) return failOperationType("code_taken", ["code"]);
  switch (errorKind(error)) {
    case "check":
      return failOperationType("invalid", ["code", "isInspection"]);
    case "denied":
      return failOperationType("denied");
    default:
      console.error("operation type write failed", error);
      return failOperationType("unexpected");
  }
}

export async function saveOperationTypeAction(
  id: unknown,
  input: unknown,
): Promise<OperationTypeActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failOperationType("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = operationTypeSchema.safeParse(input);
  if (!parsedId.success) return failOperationType("invalid");
  if (!parsed.success) {
    return failOperationType("invalid", invalidFields(parsed.error, OPERATION_TYPE_FIELDS));
  }

  const row = {
    name: parsed.data.name,
    code: parsed.data.code,
    is_external: parsed.data.isExternal,
    is_inspection: parsed.data.isInspection,
  };
  const supabase = await createClient();
  const { data, error } = parsedId.data
    ? await supabase
        .from("operation_types")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("operation_types")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) return mapOperationTypeError(error);
  if (!data) return failOperationType("not_found");

  revalidatePath("/settings/operation-types");
  revalidateProductScreens();
  return { ok: true, id: data.id };
}

/** Archived types are no longer offered; existing operations keep them. */
export async function setOperationTypeArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<OperationTypeActionResult> {
  const organizationId = await managerOrg();
  if (!organizationId) return failOperationType("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return failOperationType("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("operation_types")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return mapOperationTypeError(error);
  if (data.length === 0) return failOperationType("not_found");

  revalidatePath("/settings/operation-types");
  revalidateProductScreens();
  return { ok: true, id: parsed.data.id };
}

// ---------------------------------------------------------------------------
// Production settings (organizations.settings, org.settings.manage)
// ---------------------------------------------------------------------------
export async function saveProductionSettingsAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "denied" | "unexpected" }> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  if (!(await permitAction(organizationId, "org.settings.manage"))) {
    return { ok: false, error: "denied" };
  }
  const parsed = productionSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const current = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (current.error) throw current.error;
  const settings =
    current.data.settings &&
    typeof current.data.settings === "object" &&
    !Array.isArray(current.data.settings)
      ? current.data.settings
      : {};

  const { error } = await supabase
    .from("organizations")
    .update({
      settings: {
        ...settings,
        cycle_time_unit: parsed.data.cycleTimeUnit,
        inspection_mode: parsed.data.inspectionMode,
      },
    })
    .eq("id", organizationId);
  if (error) {
    console.error("settings update failed", error);
    return { ok: false, error: errorKind(error) === "denied" ? "denied" : "unexpected" };
  }

  revalidatePath("/settings/production");
  revalidateProductScreens();
  return { ok: true };
}
