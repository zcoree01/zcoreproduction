import "server-only";
import { pageRange, toSearchPattern } from "@/lib/data-table/params";
import { createClient } from "@/lib/supabase/server";
import type { MachineListParams } from "./list-params";
import { machineStatusSchema, type MachineStatus } from "./schemas";

export type MachineRow = {
  id: string;
  code: string;
  name: string;
  type: { id: string; name: string } | null;
  manufacturer: string | null;
  model: string | null;
  location: { id: string; name: string } | null;
  status: MachineStatus;
  statusChangedAt: string;
  notes: string | null;
  archived: boolean;
};

export type MachinePage = { rows: MachineRow[]; total: number };

const COLUMNS =
  "id, code, name, type_id, type_name, manufacturer, model, location_id, location_name, status, status_changed_at, notes, archived_at";

type DirectoryRow = {
  id: string | null;
  code: string | null;
  name: string | null;
  type_id: string | null;
  type_name: string | null;
  manufacturer: string | null;
  model: string | null;
  location_id: string | null;
  location_name: string | null;
  status: string | null;
  status_changed_at: string | null;
  notes: string | null;
  archived_at: string | null;
};

function toMachineRow(row: DirectoryRow): MachineRow[] {
  const status = machineStatusSchema.safeParse(row.status);
  if (!row.id || !row.code || !row.name || !status.success || !row.status_changed_at) return [];
  return [
    {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type_id && row.type_name ? { id: row.type_id, name: row.type_name } : null,
      manufacturer: row.manufacturer,
      model: row.model,
      location:
        row.location_id && row.location_name
          ? { id: row.location_id, name: row.location_name }
          : null,
      status: status.data,
      statusChangedAt: row.status_changed_at,
      notes: row.notes,
      archived: row.archived_at !== null,
    },
  ];
}

// One page of machines via the RLS-respecting machine_directory view.
export async function listMachinesPage(
  organizationId: string,
  params: MachineListParams,
): Promise<MachinePage> {
  const supabase = await createClient();

  const pattern = toSearchPattern(params.q);
  const filtered = () => {
    let query = supabase
      .from("machine_directory")
      .select(COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId);
    query =
      params.view === "archived"
        ? query.not("archived_at", "is", null)
        : query.is("archived_at", null);
    if (params.status) query = query.eq("status", params.status);
    if (params.type) query = query.eq("type_id", params.type);
    if (params.location) query = query.eq("location_id", params.location);
    if (pattern) {
      query = query.or(
        `code.ilike.${pattern},name.ilike.${pattern},manufacturer.ilike.${pattern},model.ilike.${pattern}`,
      );
    }
    return query;
  };

  const { from, to } = pageRange(params);
  const { data, count, error } = await filtered().order("code").range(from, to);

  if (error) {
    // Page beyond the last one (e.g. stale URL after filtering): no rows, real total.
    if (error.code === "PGRST103") {
      const counted = await filtered().limit(0);
      if (counted.error) throw counted.error;
      return { rows: [], total: counted.count ?? 0 };
    }
    throw error;
  }

  return { total: count ?? 0, rows: data.flatMap(toMachineRow) };
}

export type MachineOption = { id: string; code: string; name: string };

/** Current (non-archived) machines, for assigning employees. */
export async function listMachineOptions(organizationId: string): Promise<MachineOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machines")
    .select("id, code, name")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("code");
  if (error) throw error;
  return data;
}

export type MyMachines =
  { employee: null } | { employee: { id: string; active: boolean }; machines: MachineRow[] };

/**
 * Machines the signed-in user is qualified for, through their own employee
 * record (RLS: employees see their own row and machine assignments).
 */
export async function listMyMachines(organizationId: string, userId: string): Promise<MyMachines> {
  const supabase = await createClient();
  const employee = await supabase
    .from("employees")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();
  if (employee.error) throw employee.error;
  if (!employee.data) return { employee: null };

  const assigned = await supabase
    .from("employee_machines")
    .select("machine_id")
    .eq("organization_id", organizationId)
    .eq("employee_id", employee.data.id);
  if (assigned.error) throw assigned.error;

  const ids = assigned.data.map((row) => row.machine_id);
  let rows: DirectoryRow[] = [];
  if (ids.length > 0) {
    const machines = await supabase
      .from("machine_directory")
      .select(COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", ids)
      .is("archived_at", null)
      .order("code");
    if (machines.error) throw machines.error;
    rows = machines.data;
  }

  return {
    employee: { id: employee.data.id, active: employee.data.status === "active" },
    machines: rows.flatMap(toMachineRow),
  };
}
