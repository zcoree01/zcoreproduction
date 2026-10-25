import "server-only";
import { z } from "zod";
import { pageRange, toSearchPattern } from "@/lib/data-table/params";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_UNITS, type AttachmentKind, type ProductUnit } from "@/modules/products/schemas";
import { ATTACHMENT_KINDS } from "@/modules/products/schemas";
import type { TimeUnit } from "@/modules/products/rules";
import { describeOrderHistoryEntry, type OrderHistoryDescription } from "./history";
import { CLOSE_REQUESTED, type CustomerOrderFilters, type OrderListParams } from "./list-params";
import { orderSettingsFromSettings, type DueWarning, type OrderSettings } from "./rules";
import {
  isOperationStatus,
  isOrderStatus,
  type OperationStatus,
  type OrderStatus,
} from "./status-rules";

type Ref = { id: string; name: string };

function asUnit(value: string | null): ProductUnit {
  return (PRODUCT_UNITS as readonly string[]).includes(value ?? "")
    ? (value as ProductUnit)
    : "pcs";
}

function asDueWarning(kind: string | null, days: number | null): DueWarning | null {
  if (kind === "overdue" || kind === "behind") return { kind };
  if (kind === "due_soon" && days !== null) return { kind, days };
  return null;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export type OrderRow = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  /** Manual priority (null = automatic / normal). */
  priority: number | null;
  effectivePriority: number;
  computedPriority: number;
  dueDate: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  quantity: string;
  unit: ProductUnit;
  customer: (Ref & { number: number }) | null;
  product: { id: string; partNumber: string; name: string } | null;
  revisionId: string;
  revision: string | null;
  plannedSeconds: string;
  remainingSeconds: string;
  daysToDue: number;
  slackDays: number;
  started: boolean;
  dueWarning: DueWarning | null;
  operationCount: number;
  operationsDone: number;
  /** Good pieces of the last operation. */
  goodQuantity: string;
  /** Every operation done with enough good pieces, or closing was approved. */
  completionAllowed: boolean;
  closeRequestPending: boolean;
  /** 0–100: every operation counts equally (see private.order_progress). */
  progressPercent: number;
  /** First operation that is not done (where the order is now). */
  currentOperation: {
    code: string;
    name: string;
    machineCode: string | null;
    external: boolean;
    status: OperationStatus;
  } | null;
  createdAt: string;
};

export type OrderPage = { rows: OrderRow[]; total: number };

const LIST_COLUMNS =
  "id, order_number, status, priority, effective_priority, computed_priority, due_date, planned_start, planned_end, quantity, unit, customer_id, customer_name, customer_number, product_id, part_number, product_name, revision_id, revision, planned_seconds, remaining_seconds, days_to_due, slack_days, started, due_warning, due_warning_days, operation_count, operations_done, good_quantity, completion_allowed, close_request_pending, progress_percent, current_operation_code, current_operation_name, current_machine_code, current_operation_external, current_operation_status, created_at";

type DirectoryRow = {
  id: string | null;
  order_number: string | null;
  status: string | null;
  priority: number | null;
  effective_priority: number | null;
  computed_priority: number | null;
  due_date: string | null;
  planned_start: string | null;
  planned_end: string | null;
  quantity: number | null;
  unit: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_number: number | null;
  product_id: string | null;
  part_number: string | null;
  product_name: string | null;
  revision_id: string | null;
  revision: string | null;
  planned_seconds: number | null;
  remaining_seconds: number | null;
  days_to_due: number | null;
  slack_days: number | null;
  started: boolean | null;
  due_warning: string | null;
  due_warning_days: number | null;
  operation_count: number | null;
  operations_done: number | null;
  good_quantity: number | null;
  completion_allowed: boolean | null;
  close_request_pending: boolean | null;
  progress_percent: number | null;
  current_operation_code: string | null;
  current_operation_name: string | null;
  current_machine_code: string | null;
  current_operation_external: boolean | null;
  current_operation_status: string | null;
  created_at: string | null;
};

function toOrderRow(row: DirectoryRow): OrderRow[] {
  if (!row.id || !row.order_number || !isOrderStatus(row.status) || !row.due_date) return [];
  if (!row.revision_id || !row.created_at) return [];
  return [
    {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      priority: row.priority,
      effectivePriority: row.effective_priority ?? 3,
      computedPriority: row.computed_priority ?? 3,
      dueDate: row.due_date,
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
      quantity: decimalFromDb(row.quantity) ?? "0",
      unit: asUnit(row.unit),
      customer:
        row.customer_id && row.customer_name
          ? { id: row.customer_id, name: row.customer_name, number: row.customer_number ?? 0 }
          : null,
      product:
        row.product_id && row.part_number
          ? { id: row.product_id, partNumber: row.part_number, name: row.product_name ?? "" }
          : null,
      revisionId: row.revision_id,
      revision: row.revision,
      plannedSeconds: decimalFromDb(row.planned_seconds) ?? "0",
      remainingSeconds: decimalFromDb(row.remaining_seconds) ?? "0",
      daysToDue: row.days_to_due ?? 0,
      slackDays: row.slack_days ?? 0,
      started: row.started ?? false,
      dueWarning: asDueWarning(row.due_warning, row.due_warning_days),
      operationCount: row.operation_count ?? 0,
      operationsDone: row.operations_done ?? 0,
      goodQuantity: decimalFromDb(row.good_quantity) ?? "0",
      completionAllowed: row.completion_allowed ?? false,
      closeRequestPending: row.close_request_pending ?? false,
      progressPercent: row.progress_percent ?? 0,
      currentOperation:
        row.current_operation_code && isOperationStatus(row.current_operation_status)
          ? {
              code: row.current_operation_code,
              name: row.current_operation_name ?? "",
              machineCode: row.current_machine_code,
              external: row.current_operation_external ?? false,
              status: row.current_operation_status,
            }
          : null,
      createdAt: row.created_at,
    },
  ];
}

export async function listOrdersPage(
  organizationId: string,
  params: OrderListParams,
): Promise<OrderPage> {
  const supabase = await createClient();
  const pattern = toSearchPattern(params.q);
  const filtered = () => {
    let query = supabase
      .from("production_order_directory")
      .select(LIST_COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId);
    if (params.status === CLOSE_REQUESTED) query = query.eq("close_request_pending", true);
    else if (params.status) query = query.eq("status", params.status);
    else query = query.neq("status", "archived");
    if (params.priority) query = query.eq("effective_priority", Number(params.priority));
    if (params.customer) query = query.eq("customer_id", params.customer);
    if (params.machine) query = query.contains("machine_ids", [params.machine]);
    if (params.due === "warning") query = query.not("due_warning", "is", null);
    else if (params.due) query = query.eq("due_warning", params.due);
    if (pattern) {
      query = query.or(
        `order_number.ilike.${pattern},part_number.ilike.${pattern},product_name.ilike.${pattern},customer_name.ilike.${pattern}`,
      );
    }
    return query;
  };

  const { from, to } = pageRange(params);
  const { data, count, error } = await filtered()
    .order("effective_priority")
    .order("due_date")
    .order("order_number")
    .range(from, to);
  if (error) {
    if (error.code === "PGRST103") {
      const counted = await filtered().limit(0);
      if (counted.error) throw counted.error;
      return { rows: [], total: counted.count ?? 0 };
    }
    throw error;
  }
  return { total: count ?? 0, rows: data.flatMap(toOrderRow) };
}

/**
 * Orders of one customer (customer page), newest first, filtered by order
 * number / part number, urgency and status (incl. "close requested").
 */
export async function listCustomerOrders(
  organizationId: string,
  customerId: string,
  filters: CustomerOrderFilters = { q: "", priority: undefined, status: undefined },
): Promise<OrderRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("production_order_directory")
    .select(LIST_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId);
  if (filters.status === CLOSE_REQUESTED) query = query.eq("close_request_pending", true);
  else if (filters.status) query = query.eq("status", filters.status);
  else query = query.neq("status", "archived");
  if (filters.priority) query = query.eq("effective_priority", Number(filters.priority));
  const pattern = toSearchPattern(filters.q);
  if (pattern) query = query.or(`order_number.ilike.${pattern},part_number.ilike.${pattern}`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data.flatMap(toOrderRow);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
export type OrderDetail = OrderRow & {
  notes: string | null;
  cancelReason: string | null;
  statusChangedAt: string;
  pieceLength: string | null;
  kerf: string | null;
  barLength: string | null;
  barRemnant: string | null;
  sourceOrder: { id: string; orderNumber: string } | null;
  /** Revisions of the product (for replacing the drawings), newest first. */
  revisions: { id: string; revision: string | null; isCurrent: boolean; createdAt: string }[];
  material: string | null;
  drawingNumber: string | null;
};

export async function getOrder(organizationId: string, id: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const [listed, extra] = await Promise.all([
    supabase
      .from("production_order_directory")
      .select(LIST_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("production_orders")
      .select(
        "notes, cancel_reason, status_changed_at, piece_length_mm, kerf_mm, bar_length_mm, bar_remnant_mm, product_id, revision_id, source_order_id",
      )
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (listed.error) throw listed.error;
  if (extra.error) throw extra.error;
  const row = listed.data ? toOrderRow(listed.data)[0] : undefined;
  if (!row || !extra.data) return null;

  const [revisions, current, source] = await Promise.all([
    supabase
      .from("product_revisions")
      .select("id, revision, is_current, created_at")
      .eq("organization_id", organizationId)
      .eq("product_id", extra.data.product_id)
      .order("created_at", { ascending: false }),
    supabase
      .from("product_revisions")
      .select("drawing_number, material:materials!product_revisions_material_fkey(designation)")
      .eq("organization_id", organizationId)
      .eq("id", extra.data.revision_id)
      .maybeSingle(),
    extra.data.source_order_id
      ? supabase
          .from("production_orders")
          .select("id, order_number")
          .eq("organization_id", organizationId)
          .eq("id", extra.data.source_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (revisions.error) throw revisions.error;
  if (current.error) throw current.error;
  if (source.error) throw source.error;

  return {
    ...row,
    notes: extra.data.notes,
    cancelReason: extra.data.cancel_reason,
    statusChangedAt: extra.data.status_changed_at,
    pieceLength: decimalFromDb(extra.data.piece_length_mm),
    kerf: decimalFromDb(extra.data.kerf_mm),
    barLength: decimalFromDb(extra.data.bar_length_mm),
    barRemnant: decimalFromDb(extra.data.bar_remnant_mm),
    sourceOrder: source.data ? { id: source.data.id, orderNumber: source.data.order_number } : null,
    revisions: revisions.data.map((r) => ({
      id: r.id,
      revision: r.revision,
      isCurrent: r.is_current,
      createdAt: r.created_at,
    })),
    material: current.data?.material?.designation ?? null,
    drawingNumber: current.data?.drawing_number ?? null,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export type OrderOperationWorker = { employeeId: string; name: string; employeeNumber: number };

export type OrderOperation = {
  id: string;
  sequence: number;
  sourceOperationId: string | null;
  type: {
    id: string;
    code: string;
    name: string;
    isExternal: boolean;
    isInspection: boolean;
    isCutting: boolean;
  };
  description: string | null;
  machineType: Ref | null;
  machine: { id: string; code: string; name: string; cycleTimeUnit: TimeUnit | null } | null;
  machineTypeMismatch: boolean;
  externalCompany: string | null;
  setupTimeMin: string | null;
  cycleTimeS: string | null;
  plannedSeconds: string;
  notes: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: OperationStatus;
  workers: OrderOperationWorker[];
  overlapCount: number;
  /** Pieces that reached the operation, reported good and scrap. */
  inputQuantity: string;
  goodQuantity: string;
  scrapQuantity: string;
  /** Machine time (operation running), worker time (sum of sessions), downtime. */
  runSeconds: string;
  workerSeconds: string;
  downtimeSeconds: string;
  archived: boolean;
};

const workersSchema = z.array(
  z.object({ employee_id: z.uuid(), name: z.string(), employee_number: z.number() }),
);

export async function listOrderOperations(
  organizationId: string,
  orderId: string,
): Promise<OrderOperation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_order_operation_directory")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .order("sequence");
  if (error) throw error;

  return data.flatMap((row): OrderOperation[] => {
    if (!row.id || row.sequence === null || !row.operation_type_id || !row.operation_code) {
      return [];
    }
    if (!isOperationStatus(row.status)) return [];
    const workers = workersSchema.safeParse(row.workers);
    const unit = row.machine_cycle_time_unit;
    return [
      {
        id: row.id,
        sequence: row.sequence,
        sourceOperationId: row.source_operation_id,
        type: {
          id: row.operation_type_id,
          code: row.operation_code,
          name: row.operation_name ?? "",
          isExternal: row.is_external ?? false,
          isInspection: row.is_inspection ?? false,
          isCutting: row.is_cutting ?? false,
        },
        description: row.description,
        machineType:
          row.machine_type_id && row.machine_type_name
            ? { id: row.machine_type_id, name: row.machine_type_name }
            : null,
        machine:
          row.machine_id && row.machine_code
            ? {
                id: row.machine_id,
                code: row.machine_code,
                name: row.machine_name ?? "",
                cycleTimeUnit: unit === "min" || unit === "s" ? unit : null,
              }
            : null,
        machineTypeMismatch: row.machine_type_mismatch ?? false,
        externalCompany: row.external_company,
        setupTimeMin: decimalFromDb(row.setup_time_min),
        cycleTimeS: decimalFromDb(row.cycle_time_s),
        plannedSeconds: decimalFromDb(row.planned_seconds) ?? "0",
        notes: row.notes,
        plannedStart: row.planned_start,
        plannedEnd: row.planned_end,
        status: row.status,
        workers: workers.success
          ? workers.data.map((w) => ({
              employeeId: w.employee_id,
              name: w.name,
              employeeNumber: w.employee_number,
            }))
          : [],
        overlapCount: row.overlap_count ?? 0,
        inputQuantity: decimalFromDb(row.input_quantity) ?? "0",
        goodQuantity: decimalFromDb(row.good_quantity) ?? "0",
        scrapQuantity: decimalFromDb(row.scrap_quantity) ?? "0",
        runSeconds: decimalFromDb(row.run_seconds) ?? "0",
        workerSeconds: decimalFromDb(row.worker_seconds) ?? "0",
        downtimeSeconds: decimalFromDb(row.downtime_seconds) ?? "0",
        archived: row.archived_at !== null,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Drawings on the order
// ---------------------------------------------------------------------------
export type OrderAttachment = {
  /** production_order_attachments.id */
  id: string;
  attachmentId: string;
  kind: AttachmentKind;
  title: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  mainDrawingId: string | null;
  /** Product operation a machine drawing is for (order operations keep it as source). */
  productOperationId: string | null;
  /** Replaced by a drawing change. */
  replacedAt: string | null;
};

export async function listOrderAttachments(
  organizationId: string,
  orderId: string,
): Promise<OrderAttachment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_order_attachments")
    .select(
      "id, archived_at, created_at, attachment:product_attachments!production_order_attachments_organization_id_attachment_id_fkey(id, kind, title, file_name, content_type, size_bytes, main_drawing_id, operation_id)",
    )
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .order("created_at");
  if (error) throw error;

  return data.flatMap((row): OrderAttachment[] => {
    const a = row.attachment;
    if (!a || !(ATTACHMENT_KINDS as readonly string[]).includes(a.kind)) return [];
    return [
      {
        id: row.id,
        attachmentId: a.id,
        kind: a.kind as AttachmentKind,
        title: a.title,
        fileName: a.file_name,
        contentType: a.content_type,
        sizeBytes: a.size_bytes,
        mainDrawingId: a.main_drawing_id,
        productOperationId: a.operation_id,
        replacedAt: row.archived_at,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export type StatusLogEntry = {
  id: number;
  changedAt: string;
  actor: string | null;
  operation: { code: string; sequence: number } | null;
  from: string | null;
  to: string;
  reason: string | null;
};

export async function getOrderStatusLog(orderId: string): Promise<StatusLogEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("production_order_status_log", {
    p_order_id: orderId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    changedAt: row.changed_at,
    actor: row.full_name ?? row.username,
    operation:
      row.operation_id && row.operation_code
        ? { code: row.operation_code, sequence: row.operation_sequence }
        : null,
    from: row.from_status,
    to: row.to_status,
    reason: row.reason,
  }));
}

export type OrderHistoryEntry = OrderHistoryDescription & {
  id: number;
  createdAt: string;
  actor: string | null;
};

export async function getOrderHistory(orderId: string): Promise<OrderHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("production_order_history", { p_order_id: orderId });
  if (error) throw error;
  return data.flatMap((row): OrderHistoryEntry[] => {
    const description = describeOrderHistoryEntry({
      action: row.action,
      before: row.before,
      after: row.after,
    });
    return description
      ? [{ ...description, id: row.id, createdAt: row.created_at, actor: row.actor_username }]
      : [];
  });
}

// ---------------------------------------------------------------------------
// Settings and form options
// ---------------------------------------------------------------------------
export async function getOrderSettings(organizationId: string): Promise<OrderSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  return orderSettingsFromSettings(data.settings);
}

export type ProductChoice = {
  id: string;
  partNumber: string;
  name: string;
  unit: ProductUnit;
  customerId: string | null;
  revisions: {
    id: string;
    revision: string | null;
    isCurrent: boolean;
    cutLength: string | null;
    kerf: string | null;
  }[];
};

/** Active products with their revisions (current first), for the order form. */
export async function listProductChoices(organizationId: string): Promise<ProductChoice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, part_number, name, unit, customer_id, product_revisions(id, revision, is_current, created_at, cut_length_mm, kerf_mm)",
    )
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("part_number");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    partNumber: row.part_number,
    name: row.name,
    unit: asUnit(row.unit),
    customerId: row.customer_id,
    revisions: [...row.product_revisions]
      .sort(
        (a, b) =>
          Number(b.is_current) - Number(a.is_current) || b.created_at.localeCompare(a.created_at),
      )
      .map((r) => ({
        id: r.id,
        revision: r.revision,
        isCurrent: r.is_current,
        cutLength: decimalFromDb(r.cut_length_mm),
        kerf: decimalFromDb(r.kerf_mm),
      })),
  }));
}

export type MachineChoice = {
  id: string;
  code: string;
  name: string;
  type: Ref | null;
  cycleTimeUnit: TimeUnit | null;
};

export type EmployeeChoice = {
  id: string;
  name: string;
  employeeNumber: number;
  machineIds: string[];
  isInspector: boolean;
};

/** Machines and active employees (with qualifications) for assignments. */
export async function listAssignmentOptions(
  organizationId: string,
): Promise<{ machines: MachineChoice[]; employees: EmployeeChoice[] }> {
  const supabase = await createClient();
  const [machines, employees, inspectorRoles] = await Promise.all([
    supabase
      .from("machine_directory")
      .select("id, code, name, type_id, type_name, cycle_time_unit")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("code"),
    supabase
      .from("employee_directory")
      .select("id, full_name, employee_number, user_id, machines")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .is("archived_at", null)
      .order("last_name"),
    supabase
      .from("role_permissions")
      .select("role_id")
      .eq("organization_id", organizationId)
      .eq("permission_key", "quality.inspect"),
  ]);
  if (machines.error) throw machines.error;
  if (employees.error) throw employees.error;
  if (inspectorRoles.error) throw inspectorRoles.error;

  const roleIds = inspectorRoles.data.map((row) => row.role_id);
  const inspectors = new Set<string>();
  if (roleIds.length > 0) {
    const members = await supabase
      .from("memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .in("role_id", roleIds);
    if (members.error) throw members.error;
    for (const member of members.data) inspectors.add(member.user_id);
  }

  const machineList = z.array(z.object({ machine_id: z.uuid() }));
  return {
    machines: machines.data.flatMap((row): MachineChoice[] =>
      row.id && row.code && row.name
        ? [
            {
              id: row.id,
              code: row.code,
              name: row.name,
              type: row.type_id && row.type_name ? { id: row.type_id, name: row.type_name } : null,
              cycleTimeUnit:
                row.cycle_time_unit === "min" || row.cycle_time_unit === "s"
                  ? row.cycle_time_unit
                  : null,
            },
          ]
        : [],
    ),
    employees: employees.data.flatMap((row): EmployeeChoice[] => {
      if (!row.id || !row.full_name || row.employee_number === null) return [];
      const qualified = machineList.safeParse(row.machines);
      return [
        {
          id: row.id,
          name: row.full_name,
          employeeNumber: row.employee_number,
          machineIds: qualified.success ? qualified.data.map((m) => m.machine_id) : [],
          isInspector: row.user_id !== null && inspectors.has(row.user_id),
        },
      ];
    }),
  };
}
