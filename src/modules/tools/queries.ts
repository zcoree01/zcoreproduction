import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listStockLocations } from "@/modules/inventory/queries";
import type { ToolKind } from "./schemas";

export type ToolRow = {
  id: string;
  code: string;
  name: string;
  kind: ToolKind;
  cuttingEdges: number | null;
  homeMachineId: string | null;
  homeMachine: string | null;
  minStock: number | null;
  supplier: string | null;
  notes: string | null;
  archived: boolean;
  total: number;
  belowMinimum: boolean;
  /** Pieces per location (warehouse, shelf or machine). */
  stock: { locationId: string; location: string; machine: boolean; quantity: number }[];
  /** Insert in use per machine: cutting edges used. */
  inUse: { machine: string; edgesUsed: number }[];
};

export async function listTools(organizationId: string): Promise<ToolRow[]> {
  const supabase = await createClient();
  const [tools, balances, inserts, locations] = await Promise.all([
    supabase
      .from("tools")
      .select(
        "id, code, name, kind, cutting_edges, home_machine_id, min_stock, supplier, notes, archived_at, machine:machines(code, name)",
      )
      .eq("organization_id", organizationId)
      .order("code"),
    supabase
      .from("tool_balances")
      .select("tool_id, location_id, quantity")
      .eq("organization_id", organizationId),
    supabase
      .from("machine_inserts")
      .select("tool_id, edges_used, machine:machines(code, name)")
      .eq("organization_id", organizationId),
    listStockLocations(organizationId),
  ]);
  if (tools.error) throw tools.error;
  if (balances.error) throw balances.error;
  if (inserts.error) throw inserts.error;
  const locationById = new Map(locations.map((l) => [l.id, l]));

  return tools.data
    .map((tool) => {
      const stock = balances.data
        .filter((b) => b.tool_id === tool.id && (b.quantity ?? 0) > 0)
        .map((b) => {
          const location = locationById.get(b.location_id ?? "");
          return {
            locationId: b.location_id ?? "",
            location: location?.label ?? "",
            machine: location?.kind === "machine",
            quantity: b.quantity ?? 0,
          };
        })
        .sort(
          (a, b) =>
            Number(a.machine) - Number(b.machine) || a.location.localeCompare(b.location, "bs"),
        );
      const total = stock.reduce((sum, s) => sum + s.quantity, 0);
      return {
        id: tool.id,
        code: tool.code,
        name: tool.name,
        kind: tool.kind as ToolKind,
        cuttingEdges: tool.cutting_edges,
        homeMachineId: tool.home_machine_id,
        homeMachine: tool.machine ? `${tool.machine.code} · ${tool.machine.name}` : null,
        minStock: tool.min_stock,
        supplier: tool.supplier,
        notes: tool.notes,
        archived: tool.archived_at !== null,
        total,
        belowMinimum:
          tool.archived_at === null && tool.min_stock !== null && total < tool.min_stock,
        stock,
        inUse: inserts.data
          .filter((i) => i.tool_id === tool.id)
          .map((i) => ({ machine: i.machine?.code ?? "", edgesUsed: i.edges_used })),
      };
    })
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.code.localeCompare(b.code, "bs"));
}

export type FloorTool = {
  id: string;
  code: string;
  name: string;
  kind: ToolKind;
  cuttingEdges: number | null;
  atMachine: number;
  edgesUsed: number | null;
};

/** Tools for a tool change on an operation the caller sees (floor). */
export async function listFloorTools(operationId: string): Promise<FloorTool[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("floor_operation_tools", {
    p_operation_id: operationId,
  });
  if (error) throw error;
  return data.map((row) => ({
    id: row.tool_id,
    code: row.code,
    name: row.name,
    kind: row.kind as ToolKind,
    cuttingEdges: row.cutting_edges,
    atMachine: row.at_machine,
    edgesUsed: row.edges_used,
  }));
}
