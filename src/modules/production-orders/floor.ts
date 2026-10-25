import "server-only";
import { z } from "zod";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENT_KINDS, PRODUCT_UNITS } from "@/modules/products/schemas";
import { OPERATION_STATUSES, ORDER_STATUSES } from "./status-rules";

// Shop-floor reads. Operators have no direct access to orders: the database
// functions floor_operation_queue / floor_operation decide what they see
// (machines they are qualified for, or operations assigned to them by name).

export type FloorQueueItem = {
  operationId: string;
  orderId: string;
  orderNumber: string;
  orderStatus: (typeof ORDER_STATUSES)[number];
  priority: number;
  dueDate: string;
  dueWarning: string | null;
  quantity: string;
  unit: (typeof PRODUCT_UNITS)[number];
  partNumber: string;
  productName: string;
  revision: string | null;
  sequence: number;
  operationCode: string;
  operationName: string;
  description: string | null;
  status: (typeof OPERATION_STATUSES)[number];
  machineCode: string | null;
  isCutting: boolean;
  isInspection: boolean;
  plannedSeconds: string;
  previous: { code: string; status: (typeof OPERATION_STATUSES)[number] } | null;
  assignedByName: boolean;
};

const unitSchema = z.enum(PRODUCT_UNITS).catch("pcs");
const operationStatusSchema = z.enum(OPERATION_STATUSES);

/**
 * Open operations on `machineId` (a machine the caller is qualified for) or,
 * with null, the operations assigned to the caller by name.
 */
export async function getFloorQueue(
  organizationId: string,
  machineId: string | null,
): Promise<FloorQueueItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("floor_operation_queue", {
    p_org_id: organizationId,
    ...(machineId ? { p_machine_id: machineId } : {}),
  });
  if (error) throw error;

  return data.flatMap((row): FloorQueueItem[] => {
    const orderStatus = z.enum(ORDER_STATUSES).safeParse(row.order_status);
    const status = operationStatusSchema.safeParse(row.status);
    const previousStatus = operationStatusSchema.safeParse(row.previous_status);
    if (!orderStatus.success || !status.success) return [];
    return [
      {
        operationId: row.operation_id,
        orderId: row.order_id,
        orderNumber: row.order_number,
        orderStatus: orderStatus.data,
        priority: row.effective_priority,
        dueDate: row.due_date,
        dueWarning: row.due_warning,
        quantity: decimalFromDb(row.quantity) ?? "0",
        unit: unitSchema.parse(row.unit),
        partNumber: row.part_number,
        productName: row.product_name,
        revision: row.revision,
        sequence: row.sequence,
        operationCode: row.operation_code,
        operationName: row.operation_name,
        description: row.description,
        status: status.data,
        machineCode: row.machine_code,
        isCutting: row.is_cutting,
        isInspection: row.is_inspection,
        plannedSeconds: decimalFromDb(row.planned_seconds) ?? "0",
        previous:
          row.previous_code && previousStatus.success
            ? { code: row.previous_code, status: previousStatus.data }
            : null,
        assignedByName: row.assigned_by_name,
      },
    ];
  });
}

const numeric = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => decimalFromDb(value));

const currentSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    sequence: z.number(),
    status: operationStatusSchema,
    machine_code: z.string().nullable(),
    machine_name: z.string().nullable(),
  })
  .nullable();

const hiddenSchema = z.object({
  visible: z.literal(false),
  order_number: z.string(),
  current: currentSchema,
});

const visibleSchema = z.object({
  visible: z.literal(true),
  current: currentSchema,
  order: z.object({
    id: z.uuid(),
    order_number: z.string(),
    status: z.enum(ORDER_STATUSES),
    quantity: numeric,
    unit: unitSchema,
    due_date: z.string(),
    notes: z.string().nullable(),
    effective_priority: z.number(),
    due_warning: z.string().nullable(),
    piece_length_mm: numeric,
    kerf_mm: numeric,
    bar_length_mm: numeric,
    bar_remnant_mm: numeric,
    part_number: z.string(),
    product_name: z.string(),
    revision: z.string().nullable(),
    drawing_number: z.string().nullable(),
    material: z.string().nullable(),
    can_set_material: z.boolean(),
  }),
  operation: z.object({
    id: z.uuid(),
    sequence: z.number(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: operationStatusSchema,
    notes: z.string().nullable(),
    is_cutting: z.boolean(),
    is_inspection: z.boolean(),
    is_external: z.boolean(),
    machine_code: z.string().nullable(),
    machine_name: z.string().nullable(),
    external_company: z.string().nullable(),
    setup_time_min: numeric,
    cycle_time_s: numeric,
    planned_seconds: numeric,
    planned_start: z.string().nullable(),
    planned_end: z.string().nullable(),
    workers: z.array(z.string()),
  }),
  operations: z.array(
    z.object({
      id: z.uuid(),
      sequence: z.number(),
      code: z.string(),
      name: z.string(),
      status: operationStatusSchema,
      machine_code: z.string().nullable(),
    }),
  ),
  attachments: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(ATTACHMENT_KINDS),
      title: z.string().nullable(),
      file_name: z.string(),
      content_type: z.string(),
      for_operation: z.boolean(),
    }),
  ),
});

export type FloorOperationVisible = z.infer<typeof visibleSchema>;
export type FloorOperationHidden = z.infer<typeof hiddenSchema>;
export type FloorOperation = FloorOperationVisible | FloorOperationHidden;

/** One operation for the floor screen (QR target); null when it does not exist. */
export async function getFloorOperation(operationId: string): Promise<FloorOperation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("floor_operation", { p_operation_id: operationId });
  if (error) throw error;
  if (data === null) return null;
  return z.union([visibleSchema, hiddenSchema]).parse(data);
}
