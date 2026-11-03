import "server-only";
import { z } from "zod";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";

// Report facts from report_production / report_orders / report_inventory
// (D-043, reports.read). Times are seconds (numbers); quantities and money
// stay decimal strings.

const dec = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => decimalFromDb(value) ?? "0");
const optionalDec = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => decimalFromDb(value));
const seconds = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => (value === null ? 0 : Number(value)));
const id = z.uuid().nullable();

const productionSchema = z.object({
  output: z.array(
    z.object({
      day: z.string(),
      machine_id: id,
      employee_id: id,
      order_id: z.uuid(),
      operation_id: z.uuid(),
      /** Shift of the worker's attendance at the report (D-045). */
      shift_id: id.optional().transform((value) => value ?? null),
      good: dec,
      scrap: dec,
      planned_seconds: seconds,
    }),
  ),
  scrap: z.array(
    z.object({
      day: z.string(),
      machine_id: id,
      employee_id: id,
      order_id: z.uuid(),
      reason: z.string().nullable(),
      scrap: dec,
    }),
  ),
  machine_time: z.array(
    z.object({
      day: z.string(),
      machine_id: id,
      order_id: z.uuid(),
      operation_id: z.uuid(),
      seconds,
    }),
  ),
  worker_time: z.array(
    z.object({
      day: z.string(),
      employee_id: z.uuid(),
      machine_id: id,
      order_id: z.uuid(),
      operation_id: z.uuid(),
      shift_id: id.optional().transform((value) => value ?? null),
      seconds,
    }),
  ),
  downtime: z.array(
    z.object({
      day: z.string(),
      machine_id: id,
      employee_id: id,
      order_id: z.uuid(),
      reason: z.string(),
      seconds,
    }),
  ),
  tool_changes: z.array(
    z.object({
      day: z.string(),
      machine_id: id,
      reason: z.string(),
      changes: z.number(),
      minutes: seconds,
    }),
  ),
  machines: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      runs_unattended: z.boolean(),
      capacity_hours: z.union([z.number(), z.string()]).nullable(),
      hourly_rate: optionalDec,
      archived: z.boolean(),
    }),
  ),
  employees: z.array(z.object({ id: z.uuid(), name: z.string(), number: z.number() })),
  orders: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      customer_id: id,
      customer: z.string().nullable(),
      part_number: z.string().nullable(),
      product: z.string().nullable(),
    }),
  ),
  operations: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
  shifts: z
    .array(z.object({ id: z.uuid(), code: z.string(), name: z.string() }))
    .optional()
    .transform((value) => value ?? []),
});

export type ProductionFacts = z.infer<typeof productionSchema>;

export async function getProductionFacts(
  organizationId: string,
  from: string,
  to: string,
): Promise<ProductionFacts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_production", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return productionSchema.parse(data);
}

const orderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.string(),
  customer_id: id,
  customer: z.string().nullable(),
  part_number: z.string().nullable(),
  product: z.string().nullable(),
  quantity: dec,
  unit: z.string(),
  good: dec,
  due_date: z.string(),
  completed_on: z.string().nullable(),
  planned_seconds: seconds,
  run_seconds: seconds,
  material_cost: dec,
  machine_cost: dec,
  external_cost: dec,
  external_days: z.number(),
  rate_missing: z.boolean(),
});

export type OrderFact = z.infer<typeof orderSchema>;

export async function getOrderFacts(
  organizationId: string,
  from: string,
  to: string,
): Promise<OrderFact[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_orders", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return z.array(orderSchema).parse(data);
}

const inventorySchema = z.object({
  consumption: z.array(
    z.object({
      item_id: z.uuid(),
      order_id: z.uuid(),
      order_number: z.string(),
      quantity: dec,
      mass_kg: dec,
      value: dec,
    }),
  ),
  receipts: z.array(z.object({ item_id: z.uuid(), quantity: dec, mass_kg: dec, value: dec })),
  stock: z.array(z.object({ item_id: z.uuid(), quantity: dec, mass_kg: dec, value: dec })),
  items: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string(), unit: z.string() })),
  tools: z.array(
    z.object({
      tool_id: z.uuid(),
      code: z.string(),
      name: z.string(),
      kind: z.string(),
      machine_id: id,
      consumed: z.number().nullable(),
      scrapped: z.number().nullable(),
    }),
  ),
});

export type InventoryFacts = z.infer<typeof inventorySchema>;

export async function getInventoryFacts(
  organizationId: string,
  from: string,
  to: string,
): Promise<InventoryFacts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_inventory", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return inventorySchema.parse(data);
}
