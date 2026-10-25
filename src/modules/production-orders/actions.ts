"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, invalidFields, type DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { numericParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { zonedLocalToUtc } from "@/lib/timezone";
import { PRODUCT_FILES_BUCKET } from "@/modules/products/schemas";
import {
  ASSIGNMENT_FIELDS,
  assignmentSchema,
  copyOrderSchema,
  createOrderSchema,
  operationStatusSchema,
  ORDER_FIELDS,
  ORDER_OPERATION_FIELDS,
  ORDER_SETTINGS_FIELDS,
  orderOperationSchema,
  orderSettingsSchema,
  orderStatusChangeSchema,
  quantityFitsUnit,
  toOrderOperationRow,
  toOrderRpcArgs,
  updateOrderSchema,
  type AssignmentActionResult,
  type AssignmentError,
  type AssignmentField,
  type OrderActionResult,
  type OrderError,
  type OrderField,
  type OrderOperationActionResult,
  type OrderOperationError,
  type OrderOperationField,
  type OrderSettingsField,
  type OrderStatusActionResult,
  type OrderStatusError,
} from "./schemas";
import { canEditPlanning, isOrderStatus } from "./status-rules";

const failOrder = actionFail<OrderField, OrderError>;
const failStatus = actionFail<"reason", OrderStatusError>;
const failOperation = actionFail<OrderOperationField, OrderOperationError>;

function revalidateOrderScreens() {
  revalidatePath("/orders", "layout");
  revalidatePath("/floor", "layout");
}

/** Business-rule errors raised by the database with a fixed message. */
const RULE_ERRORS = [
  "order_closed",
  "order_not_draft",
  "order_in_production",
  "operation_done",
  "order_not_released",
  "invalid_status_transition",
  "cancel_reason_required",
  "completion_requires_production_report",
  "machine_assignment_missing",
  "cut_quantity_required",
  "worker_external",
  "worker_inactive",
  "worker_not_inspector",
  "worker_needs_machine",
  "worker_not_qualified",
] as const;
type RuleError = (typeof RULE_ERRORS)[number];

function ruleError(error: DbError): RuleError | null {
  const message = error?.message ?? "";
  return RULE_ERRORS.find((rule) => message === rule || message.startsWith(`${rule} `)) ?? null;
}

function errorKind(error: DbError) {
  switch (error?.code) {
    case "23503":
      return "foreign_key" as const;
    case "23514":
      return "check" as const;
    case "42501":
      return "denied" as const;
    case "P0002":
    case "PGRST116":
      return "not_found" as const;
    default:
      return "other" as const;
  }
}

async function memberOrg() {
  const member = await requireMember();
  return member.organization;
}

async function managerOrg(): Promise<{ id: string; timezone: string } | null> {
  const organization = await memberOrg();
  return (await permitAction(organization.id, "orders.manage")) ? organization : null;
}

function mapOrderError(error: DbError): OrderActionResult {
  const rule = ruleError(error);
  if (rule === "order_closed" || rule === "order_in_production") return failOrder(rule);
  switch (errorKind(error)) {
    case "foreign_key":
      return failOrder("invalid_reference", ["customerId", "productId", "revisionId"]);
    case "check":
      return failOrder("invalid");
    case "denied":
      return failOrder("denied");
    case "not_found":
      return failOrder("not_found");
    default:
      console.error("order write failed", error);
      return failOrder("unexpected");
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** New order: operations and drawings are copied from the product revision. */
export async function createOrderAction(input: unknown): Promise<OrderActionResult> {
  const organization = await managerOrg();
  if (!organization) return failOrder("denied");

  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return failOrder("invalid", invalidFields(parsed.error, ORDER_FIELDS));

  const supabase = await createClient();
  const product = await supabase
    .from("products")
    .select("unit")
    .eq("organization_id", organization.id)
    .eq("id", parsed.data.productId)
    .is("archived_at", null)
    .maybeSingle();
  if (product.error) return mapOrderError(product.error);
  if (!product.data) return failOrder("invalid_reference", ["productId"]);
  if (!quantityFitsUnit(parsed.data.quantity, product.data.unit)) {
    return failOrder("invalid", ["quantity"]);
  }

  const { data, error } = await supabase.rpc("create_production_order", {
    p_org_id: organization.id,
    p_order: toOrderRpcArgs(parsed.data) as Json,
  });
  if (error) return mapOrderError(error);

  revalidateOrderScreens();
  return { ok: true, id: data };
}

/**
 * Due date, priority, planned dates and notes; quantity, raw piece and bar
 * only while the order is a draft or planned (the database enforces both).
 */
export async function updateOrderAction(id: unknown, input: unknown): Promise<OrderActionResult> {
  const organization = await managerOrg();
  if (!organization) return failOrder("denied");

  const parsedId = z.uuid().safeParse(id);
  const parsed = updateOrderSchema.safeParse(input);
  if (!parsedId.success) return failOrder("invalid");
  if (!parsed.success) return failOrder("invalid", invalidFields(parsed.error, ORDER_FIELDS));

  const supabase = await createClient();
  const current = await supabase
    .from("production_orders")
    .select("status, unit")
    .eq("organization_id", organization.id)
    .eq("id", parsedId.data)
    .maybeSingle();
  if (current.error) return mapOrderError(current.error);
  if (!current.data || !isOrderStatus(current.data.status)) return failOrder("not_found");

  const values = parsed.data;
  let row: Database["public"]["Tables"]["production_orders"]["Update"] = {
    due_date: values.dueDate,
    priority: values.priority,
    planned_start: values.plannedStart,
    planned_end: values.plannedEnd,
    notes: values.notes,
  };
  if (canEditPlanning(current.data.status)) {
    if (!quantityFitsUnit(values.quantity, current.data.unit)) {
      return failOrder("invalid", ["quantity"]);
    }
    row = {
      ...row,
      quantity: numericParam(values.quantity),
      piece_length_mm: numericParam(values.pieceLength),
      kerf_mm: numericParam(values.kerf),
      bar_length_mm: numericParam(values.barLength),
      bar_remnant_mm: numericParam(values.barRemnant),
    };
  }

  const { data, error } = await supabase
    .from("production_orders")
    .update(row)
    .eq("organization_id", organization.id)
    .eq("id", parsedId.data)
    .select("id");
  if (error) return mapOrderError(error);
  if (data.length === 0) return failOrder("not_found");

  revalidateOrderScreens();
  return { ok: true, id: parsedId.data };
}

/** Repeat order with a new number; returns the new order's id. */
export async function copyOrderAction(id: unknown, input: unknown): Promise<OrderActionResult> {
  const organization = await managerOrg();
  if (!organization) return failOrder("denied");

  const parsedId = z.uuid().safeParse(id);
  const parsed = copyOrderSchema.safeParse(input);
  if (!parsedId.success) return failOrder("invalid");
  if (!parsed.success) return failOrder("invalid", invalidFields(parsed.error, ORDER_FIELDS));

  const supabase = await createClient();
  const source = await supabase
    .from("production_orders")
    .select("unit")
    .eq("organization_id", organization.id)
    .eq("id", parsedId.data)
    .maybeSingle();
  if (source.error) return mapOrderError(source.error);
  if (!source.data) return failOrder("not_found");
  if (!quantityFitsUnit(parsed.data.quantity, source.data.unit)) {
    return failOrder("invalid", ["quantity"]);
  }

  const { data, error } = await supabase.rpc("copy_production_order", {
    p_order_id: parsedId.data,
    p_order: toOrderRpcArgs(parsed.data) as Json,
  });
  if (error) return mapOrderError(error);

  revalidateOrderScreens();
  return { ok: true, id: data };
}

/**
 * Status change. Managers (orders.manage) may make every allowed transition;
 * the warehouse (orders.material.update) and the worker of the order's
 * cutting operation only the material ones. The cutting worker has no
 * permission key of its own, so set_production_order_status (SECURITY
 * DEFINER) makes that decision together with the transition rules.
 */
export async function setOrderStatusAction(
  id: unknown,
  input: unknown,
): Promise<OrderStatusActionResult> {
  await memberOrg();
  const parsedId = z.uuid().safeParse(id);
  const parsed = orderStatusChangeSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return failStatus("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_production_order_status", {
    p_order_id: parsedId.data,
    p_status: parsed.data.status,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) {
    const rule = ruleError(error);
    if (rule === "cancel_reason_required") return failStatus(rule, ["reason"]);
    if (
      rule === "invalid_status_transition" ||
      rule === "completion_requires_production_report" ||
      rule === "machine_assignment_missing" ||
      rule === "cut_quantity_required"
    ) {
      return failStatus(rule);
    }
    const kind = errorKind(error);
    if (kind === "denied") return failStatus("denied");
    if (kind === "not_found") return failStatus("not_found");
    console.error("order status change failed", error);
    return failStatus("unexpected");
  }

  revalidateOrderScreens();
  return { ok: true, id: parsedId.data };
}

/** "Change of drawing on the existing order": drawings of another revision. */
export async function replaceDrawingsAction(
  orderId: unknown,
  revisionId: unknown,
): Promise<OrderActionResult> {
  const organization = await managerOrg();
  if (!organization) return failOrder("denied");

  const parsed = z.object({ orderId: z.uuid(), revisionId: z.uuid() }).safeParse({
    orderId,
    revisionId,
  });
  if (!parsed.success) return failOrder("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_order_drawings", {
    p_order_id: parsed.data.orderId,
    p_revision_id: parsed.data.revisionId,
  });
  if (error) return mapOrderError(error);

  revalidateOrderScreens();
  return { ok: true, id: parsed.data.orderId };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
function mapOperationError(error: DbError): OrderOperationActionResult {
  const rule = ruleError(error);
  if (rule === "order_closed" || rule === "order_not_draft" || rule === "order_in_production") {
    return failOperation(rule);
  }
  switch (errorKind(error)) {
    case "foreign_key":
      return failOperation("invalid_reference", ["operationTypeId", "machineId"]);
    case "check":
      return failOperation("external_rules");
    case "denied":
      return failOperation("denied");
    case "not_found":
      return failOperation("not_found");
    default:
      console.error("order operation write failed", error);
      return failOperation("unexpected");
  }
}

async function operationTypeIsExternal(organizationId: string, typeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("operation_types")
    .select("is_external")
    .eq("organization_id", organizationId)
    .eq("id", typeId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.is_external : null;
}

/** Appends an operation to a draft order. */
export async function addOperationAction(
  orderId: unknown,
  input: unknown,
): Promise<OrderOperationActionResult> {
  const organization = await managerOrg();
  if (!organization) return failOperation("denied");

  const parsedId = z.uuid().safeParse(orderId);
  const parsed = orderOperationSchema.safeParse(input);
  if (!parsedId.success) return failOperation("invalid");
  if (!parsed.success) {
    return failOperation("invalid", invalidFields(parsed.error, ORDER_OPERATION_FIELDS));
  }
  const external = await operationTypeIsExternal(organization.id, parsed.data.operationTypeId);
  if (external === null) return failOperation("invalid_reference", ["operationTypeId"]);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_order_operation", {
    p_order_id: parsedId.data,
    p_operation: toOrderOperationRow(parsed.data, external) as Json,
  });
  if (error) return mapOperationError(error);

  revalidateOrderScreens();
  return { ok: true, id: data };
}

/** Description, times and notes of an operation (draft or planned orders). */
export async function updateOperationAction(
  operationId: unknown,
  input: unknown,
): Promise<OrderOperationActionResult> {
  const organization = await managerOrg();
  if (!organization) return failOperation("denied");

  const parsedId = z.uuid().safeParse(operationId);
  const parsed = orderOperationSchema.safeParse(input);
  if (!parsedId.success) return failOperation("invalid");
  if (!parsed.success) {
    return failOperation("invalid", invalidFields(parsed.error, ORDER_OPERATION_FIELDS));
  }
  const external = await operationTypeIsExternal(organization.id, parsed.data.operationTypeId);
  if (external === null) return failOperation("invalid_reference", ["operationTypeId"]);

  const row = toOrderOperationRow(parsed.data, external);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_order_operations")
    .update({
      description: row.description,
      setup_time_min: numericParam(row.setup_time_min),
      cycle_time_s: numericParam(row.cycle_time_s),
      notes: row.notes,
    })
    .eq("organization_id", organization.id)
    .eq("id", parsedId.data)
    .select("id");
  if (error) return mapOperationError(error);
  if (data.length === 0) return failOperation("not_found");

  revalidateOrderScreens();
  return { ok: true, id: parsedId.data };
}

/** Removes (archives) or restores an operation of a draft order. */
export async function setOperationArchivedAction(
  operationId: unknown,
  archived: unknown,
): Promise<OrderOperationActionResult> {
  const organization = await managerOrg();
  if (!organization) return failOperation("denied");

  const parsed = z
    .object({ id: z.uuid(), archived: z.boolean() })
    .safeParse({ id: operationId, archived });
  if (!parsed.success) return failOperation("invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_order_operations")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("organization_id", organization.id)
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return mapOperationError(error);
  if (data.length === 0) return failOperation("not_found");

  revalidateOrderScreens();
  return { ok: true, id: parsed.data.id };
}

export async function setOperationStatusAction(
  operationId: unknown,
  status: unknown,
): Promise<OrderStatusActionResult> {
  const organization = await managerOrg();
  if (!organization) return failStatus("denied");

  const parsed = z
    .object({ id: z.uuid(), status: operationStatusSchema })
    .safeParse({ id: operationId, status });
  if (!parsed.success) return failStatus("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_order_operation_status", {
    p_operation_id: parsed.data.id,
    p_status: parsed.data.status,
  });
  if (error) {
    const rule = ruleError(error);
    if (rule === "invalid_status_transition") return failStatus(rule);
    if (rule === "order_not_released") return failStatus("invalid_status_transition");
    const kind = errorKind(error);
    if (kind === "denied") return failStatus("denied");
    if (kind === "not_found") return failStatus("not_found");
    console.error("operation status change failed", error);
    return failStatus("unexpected");
  }

  revalidateOrderScreens();
  return { ok: true, id: parsed.data.id };
}

const warningsSchema = z.object({
  machine_type_mismatch: z.boolean(),
  overlaps: z.array(
    z.object({ order_id: z.uuid(), order_number: z.string(), operation_code: z.string() }),
  ),
});

/**
 * Machine, workers and planned times of an operation. Returns warnings
 * (other machine type, overlapping work on the machine) that never block.
 */
export async function assignOperationAction(
  operationId: unknown,
  input: unknown,
): Promise<AssignmentActionResult> {
  const fail = (
    error: AssignmentError | "invalid" | "denied" | "not_found" | "unexpected",
    fields: AssignmentField[] = [],
  ): AssignmentActionResult => ({ ok: false, error, fields });

  const organization = await managerOrg();
  if (!organization) return fail("denied");

  const parsedId = z.uuid().safeParse(operationId);
  const parsed = assignmentSchema.safeParse(input);
  if (!parsedId.success) return fail("invalid");
  if (!parsed.success) return fail("invalid", invalidFields(parsed.error, ASSIGNMENT_FIELDS));

  const toUtc = (local: string | null) =>
    local ? zonedLocalToUtc(local, organization.timezone) : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_order_operation", {
    p_operation_id: parsedId.data,
    p_machine_id: parsed.data.machineId as string,
    p_employee_ids: parsed.data.employeeIds,
    p_planned_start: toUtc(parsed.data.plannedStart) as string,
    p_planned_end: toUtc(parsed.data.plannedEnd) as string,
  });
  if (error) {
    const rule = ruleError(error);
    if (rule === "order_closed" || rule === "operation_done") return fail(rule);
    if (
      rule === "worker_external" ||
      rule === "worker_inactive" ||
      rule === "worker_not_inspector" ||
      rule === "worker_needs_machine" ||
      rule === "worker_not_qualified"
    ) {
      return fail(rule, ["employeeIds"]);
    }
    const kind = errorKind(error);
    if (kind === "foreign_key" || kind === "check") return fail("invalid_reference", ["machineId"]);
    if (kind === "denied") return fail("denied");
    if (kind === "not_found") return fail("not_found");
    console.error("operation assignment failed", error);
    return fail("unexpected");
  }

  const warnings = warningsSchema.parse(data);
  revalidateOrderScreens();
  return {
    ok: true,
    id: parsedId.data,
    warnings: {
      machineTypeMismatch: warnings.machine_type_mismatch,
      overlaps: warnings.overlaps.map((o) => ({
        orderId: o.order_id,
        orderNumber: o.order_number,
        operationCode: o.operation_code,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------

/**
 * Short-lived download URL for a drawing of an order. Storage RLS decides:
 * products.read, or a floor user who sees an operation of the order.
 */
export async function getOrderFileUrlAction(
  attachmentId: unknown,
): Promise<{ ok: true; url: string } | { ok: false; error: "invalid" | "not_found" }> {
  await memberOrg();
  const parsed = z.uuid().safeParse(attachmentId);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_file_path", {
    p_attachment_id: parsed.data,
  });
  if (error) throw error;
  if (!data) return { ok: false, error: "not_found" };

  const signed = await supabase.storage.from(PRODUCT_FILES_BUCKET).createSignedUrl(data, 300);
  if (signed.error) return { ok: false, error: "not_found" };
  return { ok: true, url: signed.data.signedUrl };
}

// ---------------------------------------------------------------------------
// Settings (organizations.settings, org.settings.manage)
// ---------------------------------------------------------------------------
export async function saveOrderSettingsAction(
  input: unknown,
): Promise<
  | { ok: true }
  | { ok: false; error: "invalid" | "denied" | "unexpected"; fields: OrderSettingsField[] }
> {
  const organization = await memberOrg();
  if (!(await permitAction(organization.id, "org.settings.manage"))) {
    return { ok: false, error: "denied", fields: [] };
  }
  const parsed = orderSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: invalidFields(parsed.error, ORDER_SETTINGS_FIELDS),
    };
  }

  const supabase = await createClient();
  const current = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organization.id)
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
        order_number_template: parsed.data.numberTemplate,
        order_number_digits: parsed.data.numberDigits,
        priority_mode: parsed.data.priorityMode,
        priority_thresholds: [...parsed.data.priorityThresholds],
        due_warning_days: parsed.data.dueWarningDays,
        work_hours_per_day: parsed.data.workHoursPerDay,
      },
    })
    .eq("id", organization.id);
  if (error) {
    console.error("order settings update failed", error);
    return {
      ok: false,
      error: errorKind(error) === "denied" ? "denied" : "unexpected",
      fields: [],
    };
  }

  revalidatePath("/settings/production");
  revalidateOrderScreens();
  return { ok: true };
}
