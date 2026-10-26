import "server-only";
import { z } from "zod";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import { zonedLocalToUtc } from "@/lib/timezone";
import { MACHINE_STATUSES, type MachineStatus } from "@/modules/machines/schemas";
import type { ProductionDay } from "./day-rules";

const numeric = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => decimalFromDb(value) ?? "0");
const optionalNumeric = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => decimalFromDb(value));

const located = {
  order_id: z.uuid(),
  order_number: z.string(),
  operation_code: z.string(),
  machine_id: z.uuid().nullable(),
  machine_code: z.string().nullable(),
  employee_id: z.uuid().nullable(),
  employee_name: z.string().nullable(),
};

const daySchema = z.object({
  reports: z.array(
    z.object({
      ...located,
      id: z.uuid(),
      at: z.string(),
      good: numeric,
      scrap: numeric,
      scrap_reason: z.string().nullable(),
      voided: z.boolean(),
    }),
  ),
  downtime: z.array(
    z.object({
      ...located,
      id: z.uuid(),
      started_at: z.string(),
      ended_at: z.string().nullable(),
      seconds: numeric,
      reason: z.string(),
      source: z.enum(["pause", "entry"]).catch("pause"),
      notes: z.string().nullable(),
    }),
  ),
  working: z.array(
    z.object({
      ...located,
      started_at: z.string(),
      operation_name: z.string(),
      employee_name: z.string(),
    }),
  ),
  tool_changes: z.array(
    z.object({
      ...located,
      id: z.uuid(),
      at: z.string(),
      tool: z.string(),
      insert_name: z.string().nullable(),
      reason: z.string(),
      duration_min: optionalNumeric,
    }),
  ),
});

const base = (row: {
  order_id: string;
  order_number: string;
  operation_code: string;
  machine_id: string | null;
  machine_code: string | null;
  employee_id: string | null;
}) => ({
  orderId: row.order_id,
  orderNumber: row.order_number,
  operationCode: row.operation_code,
  machineId: row.machine_id,
  machineCode: row.machine_code,
  employeeId: row.employee_id,
});

/** Day [00:00, 24:00) in the organization's time zone as UTC instants. */
export function dayRange(date: string, timeZone: string): { from: string; to: string } {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    from: zonedLocalToUtc(`${date}T00:00`, timeZone),
    to: zonedLocalToUtc(`${next.toISOString().slice(0, 10)}T00:00`, timeZone),
  };
}

/**
 * Reports, downtime (overlapping the day, plus every open one), open work
 * and tool changes of one day; null without orders.read.
 */
export async function getProductionDay(
  organizationId: string,
  date: string,
  timeZone: string,
): Promise<ProductionDay | null> {
  const { from, to } = dayRange(date, timeZone);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("production_day", {
    p_org_id: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (data === null) return null;
  const day = daySchema.parse(data);
  return {
    reports: day.reports.map((row) => ({
      ...base(row),
      id: row.id,
      at: row.at,
      employeeName: row.employee_name,
      good: row.good,
      scrap: row.scrap,
      scrapReason: row.scrap_reason,
      voided: row.voided,
    })),
    downtime: day.downtime.map((row) => ({
      ...base(row),
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      // Open downtime that started before the day counts from 00:00.
      seconds: row.seconds.startsWith("-") ? "0" : row.seconds,
      employeeName: row.employee_name,
      reason: row.reason,
      source: row.source,
      notes: row.notes,
    })),
    working: day.working.map((row) => ({
      ...base(row),
      startedAt: row.started_at,
      operationName: row.operation_name,
      employeeName: row.employee_name,
    })),
    toolChanges: day.tool_changes.map((row) => ({
      ...base(row),
      id: row.id,
      at: row.at,
      employeeName: row.employee_name,
      tool: row.tool,
      insert: row.insert_name,
      reason: row.reason,
      minutes: row.duration_min,
    })),
  };
}

export type FloorMachine = { id: string; code: string; name: string; status: MachineStatus };

/** Active machines with their status (machines.read via RLS), by code. */
export async function listFloorMachines(organizationId: string): Promise<FloorMachine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machines")
    .select("id, code, name, status")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .neq("status", "inactive")
    .order("code");
  if (error) throw error;
  return data.flatMap((row) => {
    const status = z.enum(MACHINE_STATUSES).safeParse(row.status);
    return status.success ? [{ ...row, status: status.data }] : [];
  });
}
