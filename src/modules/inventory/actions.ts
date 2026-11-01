"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actionFail,
  dbErrorKind,
  invalidFields,
  violates,
  type DbError,
} from "@/lib/actions/result";
import type { PermissionKey } from "@/lib/auth/permissions";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { numericParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import {
  certificateStoragePath,
  fromDisplayQuantity,
  isCertificateStoragePath,
  pairingCandidates,
} from "./rules";
import { listPairingRevisions, listStockItemOptions } from "./queries";
import {
  ADJUSTMENT_FIELDS,
  adjustmentSchema,
  CONSUMPTION_FIELDS,
  consumptionSchema,
  ISSUE_FIELDS,
  issueSchema,
  RETURN_FIELDS,
  returnSchema,
  CERTIFICATE_CONTENT_TYPES,
  CERTIFICATES_BUCKET,
  certificateMetaSchema,
  decisionSchema,
  INVENTORY_SETTINGS_FIELDS,
  inventorySettingsSchema,
  LOCATION_FIELDS,
  locationSchema,
  RECEIPT_FIELDS,
  receiptSchema,
  STOCK_ERRORS,
  STOCK_ITEM_FIELDS,
  stockItemSchema,
  TRANSFER_FIELDS,
  transferSchema,
  type AdjustmentField,
  type ConsumptionField,
  type IssueField,
  type ReturnField,
  type CertificateActionResult,
  type InventorySettingsField,
  type LocationActionResult,
  type LocationField,
  type MoveActionResult,
  type ReceiptField,
  type StockError,
  type StockItemActionResult,
  type StockItemField,
  type TransferField,
} from "./schemas";

// Material warehouse actions (D-031). Every mutation checks its permission
// here; stock changes only through the database functions, which check it
// again, lock the items, forbid negative stock and write the audit log.

async function orgWith(permission: PermissionKey): Promise<string | null> {
  const member = await requireMember();
  const organizationId = member.organization.id;
  return (await permitAction(organizationId, permission)) ? organizationId : null;
}

function revalidateInventory() {
  revalidatePath("/inventory", "layout");
}

/** Rule message of a database function, a common error, or null (log it). */
function stockError(error: DbError): StockError | "denied" | "not_found" | "invalid" | null {
  const message = error?.message ?? "";
  const rule = STOCK_ERRORS.find((key) => message === key || message.startsWith(`${key} `));
  if (rule) return rule;
  switch (error?.code) {
    case "42501":
      return "denied";
    case "P0002":
    case "PGRST116":
      return "not_found";
    case "22023":
    case "22P02":
    case "23503":
    case "23514":
      return "invalid";
    default:
      return null;
  }
}

function moveFail<TField extends string>(
  error: DbError,
  context: string,
): MoveActionResult<TField> {
  const kind = stockError(error);
  if (kind) return actionFail<TField, StockError>(kind);
  console.error(`${context} failed`, error);
  return actionFail<TField, StockError>("unexpected");
}

// ---------------------------------------------------------------------------
// Stock items
// ---------------------------------------------------------------------------

export async function saveStockItemAction(
  id: unknown,
  input: unknown,
): Promise<StockItemActionResult> {
  const fail = actionFail<StockItemField, "code_taken" | StockError>;
  const organizationId = await orgWith("inventory.items.manage");
  if (!organizationId) return fail("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = stockItemSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, STOCK_ITEM_FIELDS));
  const item = parsed.data;

  const row = {
    code: item.code,
    name: item.name,
    material_id: item.materialId,
    shape: item.shape,
    diameter_mm: numericParam(item.diameter),
    width_mm: numericParam(item.width),
    thickness_mm: numericParam(item.thickness),
    profile_label: item.profileLabel,
    base_unit: item.baseUnit,
    standard_length_mm: numericParam(item.standardLength),
    standard_width_mm: numericParam(item.standardWidth),
    mass_per_m_kg: numericParam(item.massPerM),
    supplier: item.supplier,
    min_stock: numericParam(
      item.minStock === null ? null : fromDisplayQuantity(item.baseUnit, item.minStock),
    ),
    default_location_id: item.defaultLocationId,
    notes: item.notes,
  };
  const supabase = await createClient();
  const { data, error } = parsedId.data
    ? await supabase
        .from("stock_items")
        .update(row)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("stock_items")
        .insert({ ...row, organization_id: organizationId })
        .select("id")
        .single();
  if (error) {
    if (violates(error, "stock_items_code_key")) return fail("code_taken", ["code"]);
    if (error.message === "item_has_movements") return fail("item_has_movements");
    if (dbErrorKind(error) === "foreign_key") {
      return fail("invalid", ["materialId", "defaultLocationId"]);
    }
    if (dbErrorKind(error) === "denied") return fail("denied");
    console.error("stock item save failed", error);
    return fail("unexpected");
  }
  if (!data) return fail("not_found");

  revalidateInventory();
  return { ok: true, id: data.id };
}

export async function setStockItemArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<StockItemActionResult> {
  const fail = actionFail<StockItemField, "code_taken" | StockError>;
  const organizationId = await orgWith("inventory.items.manage");
  if (!organizationId) return fail("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) {
    // Restoring next to an active item with the same code.
    if (violates(error, "stock_items_code_key")) return fail("code_taken", ["code"]);
    console.error("stock item archive failed", error);
    return fail("unexpected");
  }
  if (!data) return fail("not_found");

  revalidateInventory();
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function saveLocationAction(
  id: unknown,
  input: unknown,
): Promise<LocationActionResult> {
  const fail = actionFail<LocationField, "code_taken" | StockError>;
  const organizationId = await orgWith("inventory.items.manage");
  if (!organizationId) return fail("denied");

  const parsedId = z.uuid().nullable().safeParse(id);
  const parsed = locationSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, LOCATION_FIELDS));
  const location = parsed.data;

  const supabase = await createClient();
  const common = {
    parent_id: location.parentId,
    machine_id: location.machineId,
    code: location.code,
    name: location.name,
  };
  const { data, error } = parsedId.data
    ? await supabase
        .from("stock_locations")
        .update(common)
        .eq("organization_id", organizationId)
        .eq("id", parsedId.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("stock_locations")
        .insert({ ...common, kind: location.kind, organization_id: organizationId })
        .select("id")
        .single();
  if (error) {
    if (violates(error, "stock_locations_code_key")) return fail("code_taken", ["code"]);
    if (error.message === "shelf_needs_warehouse")
      return fail("shelf_needs_warehouse", ["parentId"]);
    if (dbErrorKind(error) === "foreign_key") return fail("invalid", ["parentId", "machineId"]);
    if (dbErrorKind(error) === "denied") return fail("denied");
    console.error("stock location save failed", error);
    return fail("unexpected");
  }
  if (!data) return fail("not_found");

  revalidateInventory();
  return { ok: true, id: data.id };
}

export async function setLocationArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<LocationActionResult> {
  const fail = actionFail<LocationField, "code_taken" | StockError>;
  const organizationId = await orgWith("inventory.items.manage");
  if (!organizationId) return fail("denied");

  const parsed = z.object({ id: z.uuid(), archived: z.boolean() }).safeParse({ id, archived });
  if (!parsed.success) return fail("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_locations")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (violates(error, "stock_locations_code_key")) return fail("code_taken", ["code"]);
    console.error("stock location archive failed", error);
    return fail("unexpected");
  }
  if (!data) return fail("not_found");

  revalidateInventory();
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export async function postReceiptAction(input: unknown): Promise<MoveActionResult<ReceiptField>> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return actionFail<ReceiptField, StockError>("denied");

  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    return actionFail<ReceiptField, StockError>(
      "invalid",
      invalidFields(parsed.error, RECEIPT_FIELDS),
    );
  }
  const receipt = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_stock_receipt", {
    p_org_id: organizationId,
    p_idempotency_key: receipt.idempotencyKey,
    p_header: {
      document_date: receipt.documentDate,
      supplier: receipt.supplier,
      delivery_note: receipt.deliveryNote,
      notes: receipt.notes,
      price_includes_vat: receipt.pricesIncludeVat,
    },
    p_lines: receipt.lines.map((line) => ({
      item_id: line.itemId,
      location_id: line.locationId,
      pieces: line.pieces,
      length_mm: line.length,
      width_mm: line.width,
      quantity: line.quantity,
      heat_number: line.heatNumber,
      owner_customer_id: line.ownerCustomerId,
      unit_price: line.ownerCustomerId ? null : line.unitPrice,
      price_unit: line.ownerCustomerId ? null : line.priceUnit,
      invoice_kg: line.invoiceKg,
    })) satisfies Json,
  });
  if (error) return moveFail<ReceiptField>(error, "stock receipt");

  revalidateInventory();
  return { ok: true, id: data };
}

export async function postTransferAction(input: unknown): Promise<MoveActionResult<TransferField>> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return actionFail<TransferField, StockError>("denied");

  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return actionFail<TransferField, StockError>(
      "invalid",
      invalidFields(parsed.error, TRANSFER_FIELDS),
    );
  }
  const t = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_stock_transfer", {
    p_org_id: organizationId,
    p_idempotency_key: t.idempotencyKey,
    p_lines: [
      {
        item_id: t.itemId,
        lot_id: t.lotId,
        from_location_id: t.fromLocationId,
        to_location_id: t.toLocationId,
        pieces: t.pieces,
        length_mm: t.length,
        width_mm: t.width,
        quantity: t.quantity,
      },
    ],
    p_notes: t.notes ?? "",
  });
  if (error) return moveFail<TransferField>(error, "stock transfer");

  revalidateInventory();
  return { ok: true, id: data };
}

/** Proposes a correction; `post` books it at once (inventory.adjust.approve). */
export async function requestAdjustmentAction(
  input: unknown,
): Promise<MoveActionResult<AdjustmentField>> {
  const parsed = adjustmentSchema.safeParse(input);
  const organizationId = await orgWith(
    parsed.success && parsed.data.post ? "inventory.adjust.approve" : "inventory.move",
  );
  if (!organizationId) return actionFail<AdjustmentField, StockError>("denied");
  if (!parsed.success) {
    return actionFail<AdjustmentField, StockError>(
      "invalid",
      invalidFields(parsed.error, ADJUSTMENT_FIELDS),
    );
  }
  const a = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_stock_adjustment", {
    p_org_id: organizationId,
    p_idempotency_key: a.idempotencyKey,
    p_reason: a.reason,
    p_post: a.post,
    p_lines: [
      {
        item_id: a.itemId,
        lot_id: a.lotId,
        location_id: a.locationId,
        pieces: a.pieces,
        length_mm: a.length,
        width_mm: a.width,
        quantity: a.pieces === null ? a.quantity : null,
      },
    ],
  });
  if (error) return moveFail<AdjustmentField>(error, "stock adjustment");

  revalidateInventory();
  return { ok: true, id: data };
}

export async function decideAdjustmentAction(input: unknown): Promise<MoveActionResult<"note">> {
  const organizationId = await orgWith("inventory.adjust.approve");
  if (!organizationId) return actionFail<"note", StockError>("denied");

  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return actionFail<"note", StockError>("invalid", invalidFields(parsed.error, ["note"]));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_stock_adjustment", {
    p_document_id: parsed.data.documentId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note ?? "",
  });
  if (error) return moveFail<"note">(error, "stock adjustment decision");

  revalidateInventory();
  return { ok: true, id: parsed.data.documentId };
}

// ---------------------------------------------------------------------------
// Certificates: prepare (signed upload URL) → browser upload → register
// ---------------------------------------------------------------------------

type CertificateTicket =
  { ok: true; path: string; token: string } | Extract<CertificateActionResult, { ok: false }>;

async function lotExists(organizationId: string, lotId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_lots")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", lotId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function prepareCertificateUploadAction(input: unknown): Promise<CertificateTicket> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return { ok: false, error: "denied", fields: [] };

  const parsed = certificateMetaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fields: [] };
  if (!(await lotExists(organizationId, parsed.data.lotId))) {
    return { ok: false, error: "not_found", fields: [] };
  }

  const path = certificateStoragePath(
    organizationId,
    parsed.data.lotId,
    randomUUID(),
    CERTIFICATE_CONTENT_TYPES[parsed.data.contentType],
  );
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(CERTIFICATES_BUCKET)
    .createSignedUploadUrl(path);
  if (error) {
    console.error("certificate upload url failed", error);
    return { ok: false, error: "upload_failed", fields: [] };
  }
  return { ok: true, path: data.path, token: data.token };
}

/** Records an uploaded certificate; size and type are read back from Storage. */
export async function registerCertificateAction(
  input: unknown,
  path: unknown,
): Promise<CertificateActionResult> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return { ok: false, error: "denied", fields: [] };

  const parsed = certificateMetaSchema.safeParse(input);
  const parsedPath = z.string().max(500).safeParse(path);
  if (!parsed.success || !parsedPath.success) return { ok: false, error: "invalid", fields: [] };
  if (!isCertificateStoragePath(parsedPath.data, organizationId, parsed.data.lotId)) {
    return { ok: false, error: "invalid", fields: [] };
  }

  const supabase = await createClient();
  const info = await supabase.storage.from(CERTIFICATES_BUCKET).info(parsedPath.data);
  if (info.error || !info.data.size) return { ok: false, error: "upload_failed", fields: [] };
  const contentType = certificateMetaSchema.shape.contentType.safeParse(info.data.contentType);
  if (!contentType.success) return { ok: false, error: "file_type", fields: [] };

  const { data, error } = await supabase
    .from("stock_lot_certificates")
    .upsert(
      {
        organization_id: organizationId,
        lot_id: parsed.data.lotId,
        storage_path: parsedPath.data,
        file_name: parsed.data.fileName,
        mime_type: contentType.data,
        size_bytes: info.data.size,
      },
      // Registered already (double submit): keep the existing row.
      { onConflict: "storage_path", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) {
    if (dbErrorKind(error) === "denied") return { ok: false, error: "denied", fields: [] };
    console.error("certificate insert failed", error);
    return { ok: false, error: "unexpected", fields: [] };
  }

  revalidateInventory();
  return { ok: true, id: data?.id ?? parsed.data.lotId };
}

export async function setCertificateArchivedAction(id: unknown): Promise<CertificateActionResult> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return { ok: false, error: "denied", fields: [] };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "invalid", fields: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_lot_certificates")
    .update({ archived_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("certificate archive failed", error);
    return { ok: false, error: "unexpected", fields: [] };
  }
  if (!data) return { ok: false, error: "not_found", fields: [] };

  revalidateInventory();
  return { ok: true, id: data.id };
}

/** Short-lived download link for a certificate (inventory.read via Storage RLS). */
export async function certificateUrlAction(
  id: unknown,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const organizationId = await orgWith("inventory.read");
  const parsed = z.uuid().safeParse(id);
  if (!organizationId || !parsed.success) return { ok: false };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_lot_certificates")
    .select("storage_path")
    .eq("organization_id", organizationId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (error || !data) return { ok: false };
  const signed = await supabase.storage
    .from(CERTIFICATES_BUCKET)
    .createSignedUrl(data.storage_path, 300);
  if (signed.error) return { ok: false };
  return { ok: true, url: signed.data.signedUrl };
}

// ---------------------------------------------------------------------------
// Pairing products with stock items (products.manage)
// ---------------------------------------------------------------------------

export type PairingResult =
  | { ok: true; paired: number }
  | { ok: false; error: "denied" | "invalid" | "not_found" | "not_current" | "unexpected" };

async function setRevisionStockItem(
  organizationId: string,
  revisionId: string,
  stockItemId: string | null,
): Promise<"ok" | "not_found" | "not_current" | "invalid" | "unexpected"> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_revisions")
    .update({ stock_item_id: stockItemId })
    .eq("organization_id", organizationId)
    .eq("id", revisionId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "55000") return "not_current";
    if (dbErrorKind(error) === "foreign_key") return "invalid";
    console.error("revision stock item update failed", error);
    return "unexpected";
  }
  return data ? "ok" : "not_found";
}

export async function linkRevisionStockItemAction(
  revisionId: unknown,
  stockItemId: unknown,
): Promise<PairingResult> {
  const organizationId = await orgWith("products.manage");
  if (!organizationId) return { ok: false, error: "denied" };

  const parsed = z
    .object({ revisionId: z.uuid(), stockItemId: z.uuid().nullable() })
    .safeParse({ revisionId, stockItemId });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const result = await setRevisionStockItem(
    organizationId,
    parsed.data.revisionId,
    parsed.data.stockItemId,
  );
  if (result !== "ok") return { ok: false, error: result };

  revalidateInventory();
  revalidatePath("/products", "layout");
  return { ok: true, paired: 1 };
}

/** Links every unpaired current revision that has exactly one candidate item. */
export async function autoPairAction(): Promise<PairingResult> {
  const organizationId = await orgWith("products.manage");
  if (!organizationId) return { ok: false, error: "denied" };

  const [revisions, items] = await Promise.all([
    listPairingRevisions(organizationId),
    listStockItemOptions(organizationId),
  ]);
  let paired = 0;
  for (const revision of revisions) {
    if (revision.stockItemId) continue;
    const candidates = pairingCandidates(revision, items);
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (!only) continue;
    const result = await setRevisionStockItem(organizationId, revision.revisionId, only.id);
    if (result === "ok") paired += 1;
    else if (result === "unexpected") return { ok: false, error: "unexpected" };
  }

  if (paired > 0) {
    const supabase = await createClient();
    await supabase.rpc("write_audit", {
      p_org_id: organizationId,
      p_action: "products.stock_items_auto_paired",
      p_entity_type: "product_revisions",
      p_after: { paired },
    });
    revalidateInventory();
    revalidatePath("/products", "layout");
  }
  return { ok: true, paired };
}

// ---------------------------------------------------------------------------
// Settings (organizations.settings.inventory, org.settings.manage)
// ---------------------------------------------------------------------------

export async function saveInventorySettingsAction(
  input: unknown,
): Promise<MoveActionResult<InventorySettingsField>> {
  const fail = actionFail<InventorySettingsField, StockError>;
  const organizationId = await orgWith("org.settings.manage");
  if (!organizationId) return fail("denied");

  const parsed = inventorySettingsSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid", invalidFields(parsed.error, INVENTORY_SETTINGS_FIELDS));

  const supabase = await createClient();
  const current = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (current.error) {
    console.error("settings read failed", current.error);
    return fail("unexpected");
  }
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
        inventory: {
          remnant_min_length_mm: parsed.data.remnantMinLengthMm,
          vat_rate: parsed.data.vatRate,
          prices_include_vat: parsed.data.pricesIncludeVat,
        },
      },
    })
    .eq("id", organizationId);
  if (error) {
    if (dbErrorKind(error) === "denied") return fail("denied");
    console.error("inventory settings save failed", error);
    return fail("unexpected");
  }

  revalidateInventory();
  return { ok: true, id: organizationId };
}

// ---------------------------------------------------------------------------
// Material of production orders (D-032)
// ---------------------------------------------------------------------------

function revalidateOrderMaterial(orderId: string) {
  revalidateInventory();
  revalidatePath(`/orders/${orderId}`);
}

export async function postIssueAction(input: unknown): Promise<MoveActionResult<IssueField>> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return actionFail<IssueField, StockError>("denied");

  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return actionFail<IssueField, StockError>("invalid", invalidFields(parsed.error, ISSUE_FIELDS));
  }
  const i = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_stock_issue", {
    p_org_id: organizationId,
    p_idempotency_key: i.idempotencyKey,
    p_order_id: i.orderId,
    p_notes: i.notes ?? "",
    p_lines: [
      {
        item_id: i.itemId,
        lot_id: i.lotId,
        location_id: i.locationId,
        pieces: i.pieces,
        length_mm: i.length,
        width_mm: i.width,
        quantity: i.quantity,
        cut_pieces: i.cutPieces,
        offcut_length_mm: i.offcutLength,
        offcut_width_mm: i.offcutWidth,
        offcut_location_id: i.offcutLocationId,
      },
    ],
  });
  if (error) return moveFail<IssueField>(error, "stock issue");

  revalidateOrderMaterial(i.orderId);
  return { ok: true, id: data };
}

export async function postReturnAction(input: unknown): Promise<MoveActionResult<ReturnField>> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return actionFail<ReturnField, StockError>("denied");

  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) {
    return actionFail<ReturnField, StockError>(
      "invalid",
      invalidFields(parsed.error, RETURN_FIELDS),
    );
  }
  const r = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_stock_return", {
    p_org_id: organizationId,
    p_idempotency_key: r.idempotencyKey,
    p_order_id: r.orderId,
    p_notes: r.notes ?? "",
    p_lines: [
      {
        item_id: r.itemId,
        lot_id: r.lotId,
        location_id: r.locationId,
        pieces: r.pieces,
        length_mm: r.length,
        width_mm: r.width,
        quantity: r.quantity,
      },
    ],
  });
  if (error) return moveFail<ReturnField>(error, "stock return");

  revalidateOrderMaterial(r.orderId);
  return { ok: true, id: data };
}

/** Confirms (or corrects) the consumed quantity of an order, in the display unit. */
export async function confirmConsumptionAction(
  input: unknown,
  baseUnit: unknown,
): Promise<MoveActionResult<ConsumptionField>> {
  const organizationId = await orgWith("inventory.move");
  if (!organizationId) return actionFail<ConsumptionField, StockError>("denied");

  const parsed = consumptionSchema.safeParse(input);
  const unit = z.enum(["mm", "m2", "kg", "pcs"]).safeParse(baseUnit);
  if (!parsed.success || !unit.success) {
    return actionFail<ConsumptionField, StockError>(
      "invalid",
      parsed.success ? [] : invalidFields(parsed.error, CONSUMPTION_FIELDS),
    );
  }
  const c = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_order_consumption", {
    p_order_id: c.orderId,
    p_item_id: c.itemId,
    p_quantity: numericParam(fromDisplayQuantity(unit.data, c.quantity ?? "0")),
    p_note: c.note ?? "",
  });
  if (error) return moveFail<ConsumptionField>(error, "order consumption");

  revalidateOrderMaterial(c.orderId);
  return { ok: true, id: c.orderId };
}
