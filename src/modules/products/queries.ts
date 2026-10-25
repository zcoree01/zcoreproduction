import "server-only";
import { pageRange, toSearchPattern } from "@/lib/data-table/params";
import { decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import type { ProductListParams } from "./list-params";
import {
  cycleUnitFromSettings,
  describeHistoryEntry,
  inspectionModeFromSettings,
  type HistoryDescription,
  type InspectionModeValue,
  type TimeUnit,
} from "./rules";
import {
  ATTACHMENT_KINDS,
  BLANK_GEOMETRIES,
  INSPECTION_PLANS,
  PRODUCT_UNITS,
  type AttachmentKind,
  type BlankGeometry,
  type InspectionPlan,
  type ProductUnit,
} from "./schemas";

type Ref = { id: string; name: string };

function ref(id: string | null, name: string | null | undefined): Ref | null {
  return id && name ? { id, name } : null;
}

function asUnit(value: string | null): ProductUnit {
  return (PRODUCT_UNITS as readonly string[]).includes(value ?? "")
    ? (value as ProductUnit)
    : "pcs";
}

function asTimeUnit(value: string | null): TimeUnit | null {
  return value === "min" || value === "s" ? value : null;
}

function asInspectionPlan(value: string | null): InspectionPlan {
  return (INSPECTION_PLANS as readonly string[]).includes(value ?? "")
    ? (value as InspectionPlan)
    : "none";
}

export type MaterialRef = { id: string; designation: string; groupName: string };

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export type ProductRow = {
  id: string;
  partNumber: string;
  name: string;
  customer: Ref | null;
  type: Ref | null;
  unit: ProductUnit;
  revision: string | null;
  drawingNumber: string | null;
  material: MaterialRef | null;
  operationCount: number;
  archived: boolean;
};

export type ProductPage = { rows: ProductRow[]; total: number };

const LIST_COLUMNS =
  "id, part_number, name, customer_id, customer_name, product_type_id, product_type_name, unit, revision, drawing_number, material_id, material_designation, material_group_name, operation_count, archived_at";

export async function listProductsPage(
  organizationId: string,
  params: ProductListParams,
): Promise<ProductPage> {
  const supabase = await createClient();
  const pattern = toSearchPattern(params.q);
  const filtered = () => {
    let query = supabase
      .from("product_directory")
      .select(LIST_COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId);
    query =
      params.view === "archived"
        ? query.not("archived_at", "is", null)
        : query.is("archived_at", null);
    if (params.type) query = query.eq("product_type_id", params.type);
    if (params.customer) query = query.eq("customer_id", params.customer);
    if (pattern) {
      query = query.or(
        `part_number.ilike.${pattern},name.ilike.${pattern},customer_name.ilike.${pattern},drawing_number.ilike.${pattern}`,
      );
    }
    return query;
  };

  const { from, to } = pageRange(params);
  const { data, count, error } = await filtered().order("part_number").range(from, to);
  if (error) {
    if (error.code === "PGRST103") {
      const counted = await filtered().limit(0);
      if (counted.error) throw counted.error;
      return { rows: [], total: counted.count ?? 0 };
    }
    throw error;
  }

  return {
    total: count ?? 0,
    rows: data.flatMap((row): ProductRow[] =>
      row.id && row.part_number && row.name
        ? [
            {
              id: row.id,
              partNumber: row.part_number,
              name: row.name,
              customer: ref(row.customer_id, row.customer_name),
              type: ref(row.product_type_id, row.product_type_name),
              unit: asUnit(row.unit),
              revision: row.revision,
              drawingNumber: row.drawing_number,
              material:
                row.material_id && row.material_designation
                  ? {
                      id: row.material_id,
                      designation: row.material_designation,
                      groupName: row.material_group_name ?? "",
                    }
                  : null,
              operationCount: row.operation_count ?? 0,
              archived: row.archived_at !== null,
            },
          ]
        : [],
    ),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
export type RevisionSummary = {
  id: string;
  /** null: first revision without a label. */
  revision: string | null;
  isCurrent: boolean;
  createdAt: string;
};

export type ProductRevision = RevisionSummary & {
  drawingNumber: string | null;
  description: string | null;
  material: (MaterialRef & { density: string | null }) | null;
  blankGeometry: BlankGeometry | null;
  blankDiameter: string | null;
  blankWidth: string | null;
  blankThickness: string | null;
  cutLength: string | null;
  kerf: string | null;
  netMass: string | null;
};

export type ProductDetail = {
  id: string;
  partNumber: string;
  name: string;
  customer: Ref | null;
  type: Ref | null;
  unit: ProductUnit;
  inspectionPlan: InspectionPlan;
  archived: boolean;
  revisions: RevisionSummary[];
};

/** Product with its revisions (newest first), or null (missing or no access). */
export async function getProduct(
  organizationId: string,
  id: string,
): Promise<ProductDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, part_number, name, customer_id, product_type_id, unit, inspection_plan, archived_at, customer:customers!products_customer_fkey(name), type:catalog_items!products_organization_id_product_type_kind_product_type_id_fkey(name), product_revisions(id, revision, is_current, created_at)",
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    partNumber: data.part_number,
    name: data.name,
    customer: ref(data.customer_id, data.customer?.name),
    type: ref(data.product_type_id, data.type?.name),
    unit: asUnit(data.unit),
    inspectionPlan: asInspectionPlan(data.inspection_plan),
    archived: data.archived_at !== null,
    revisions: data.product_revisions
      .map((r) => ({
        id: r.id,
        revision: r.revision,
        isCurrent: r.is_current,
        createdAt: r.created_at,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function getRevision(
  organizationId: string,
  revisionId: string,
): Promise<ProductRevision | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_revisions")
    .select(
      "id, revision, is_current, created_at, drawing_number, description, blank_geometry, blank_diameter_mm, blank_width_mm, blank_thickness_mm, cut_length_mm, kerf_mm, net_mass_kg, material:materials!product_revisions_material_fkey(id, designation, density_kg_dm3, group:material_groups(name, density_kg_dm3))",
    )
    .eq("organization_id", organizationId)
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    revision: data.revision,
    isCurrent: data.is_current,
    createdAt: data.created_at,
    drawingNumber: data.drawing_number,
    description: data.description,
    material: data.material
      ? {
          id: data.material.id,
          designation: data.material.designation,
          groupName: data.material.group.name,
          density:
            decimalFromDb(data.material.density_kg_dm3) ??
            decimalFromDb(data.material.group.density_kg_dm3),
        }
      : null,
    blankGeometry: (BLANK_GEOMETRIES as readonly string[]).includes(data.blank_geometry ?? "")
      ? (data.blank_geometry as BlankGeometry)
      : null,
    blankDiameter: decimalFromDb(data.blank_diameter_mm),
    blankWidth: decimalFromDb(data.blank_width_mm),
    blankThickness: decimalFromDb(data.blank_thickness_mm),
    cutLength: decimalFromDb(data.cut_length_mm),
    kerf: decimalFromDb(data.kerf_mm),
    netMass: decimalFromDb(data.net_mass_kg),
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export type ProductOperation = {
  id: string;
  sequence: number;
  /** Inspection placed by the inspection plan (read-only, moves with the routing). */
  autoInspection: boolean;
  type: { id: string; name: string; code: string; isExternal: boolean; isInspection: boolean };
  description: string | null;
  machineType: Ref | null;
  machine: { id: string; code: string; name: string; cycleTimeUnit: TimeUnit | null } | null;
  externalCompany: string | null;
  setupTimeMin: string | null;
  cycleTimeS: string | null;
  notes: string | null;
  archived: boolean;
};

export async function listOperations(
  organizationId: string,
  revisionId: string,
): Promise<ProductOperation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_operations")
    .select(
      "id, sequence, auto_inspection, description, machine_type_id, machine_id, external_company, setup_time_min, cycle_time_s, notes, archived_at, type:operation_types(id, name, code, is_external, is_inspection), machine_type:catalog_items!product_operations_organization_id_machine_type_kind_machi_fkey(name), machine:machines(id, code, name, cycle_time_unit)",
    )
    .eq("organization_id", organizationId)
    .eq("revision_id", revisionId)
    .order("sequence");
  if (error) throw error;

  return data.flatMap((row): ProductOperation[] =>
    row.type
      ? [
          {
            id: row.id,
            sequence: row.sequence,
            autoInspection: row.auto_inspection,
            type: {
              id: row.type.id,
              name: row.type.name,
              code: row.type.code,
              isExternal: row.type.is_external,
              isInspection: row.type.is_inspection,
            },
            description: row.description,
            machineType: ref(row.machine_type_id, row.machine_type?.name),
            machine: row.machine
              ? {
                  id: row.machine.id,
                  code: row.machine.code,
                  name: row.machine.name,
                  cycleTimeUnit: asTimeUnit(row.machine.cycle_time_unit),
                }
              : null,
            externalCompany: row.external_company,
            setupTimeMin: decimalFromDb(row.setup_time_min),
            cycleTimeS: decimalFromDb(row.cycle_time_s),
            notes: row.notes,
            archived: row.archived_at !== null,
          },
        ]
      : [],
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
export type ProductAttachment = {
  id: string;
  kind: AttachmentKind;
  title: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  mainDrawingId: string | null;
  operationId: string | null;
  createdAt: string;
  archived: boolean;
};

export async function listAttachments(
  organizationId: string,
  revisionId: string,
): Promise<ProductAttachment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_attachments")
    .select(
      "id, kind, title, file_name, content_type, size_bytes, main_drawing_id, operation_id, created_at, archived_at",
    )
    .eq("organization_id", organizationId)
    .eq("revision_id", revisionId)
    .order("created_at");
  if (error) throw error;

  return data.flatMap((row): ProductAttachment[] =>
    (ATTACHMENT_KINDS as readonly string[]).includes(row.kind)
      ? [
          {
            id: row.id,
            kind: row.kind as AttachmentKind,
            title: row.title,
            fileName: row.file_name,
            contentType: row.content_type,
            sizeBytes: row.size_bytes,
            mainDrawingId: row.main_drawing_id,
            operationId: row.operation_id,
            createdAt: row.created_at,
            archived: row.archived_at !== null,
          },
        ]
      : [],
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export type HistoryEntry = HistoryDescription & {
  id: number;
  createdAt: string;
  actor: string | null;
};

export async function getProductHistory(productId: string): Promise<HistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("product_history", { p_product_id: productId });
  if (error) throw error;

  return data.flatMap((row): HistoryEntry[] => {
    const description = describeHistoryEntry({
      action: row.action,
      entityType: row.entity_type,
      before: row.before,
      after: row.after,
    });
    return description
      ? [{ ...description, id: row.id, createdAt: row.created_at, actor: row.actor_username }]
      : [];
  });
}

// ---------------------------------------------------------------------------
// Operation types and settings
// ---------------------------------------------------------------------------
export type OperationType = {
  id: string;
  name: string;
  code: string;
  isExternal: boolean;
  isInspection: boolean;
  /** Sawing / cutting raw pieces: its worker may set the material statuses of orders. */
  isCutting: boolean;
  archived: boolean;
};

/** All operation types (archived last), or only active ones. */
export async function listOperationTypes(
  organizationId: string,
  options: { includeArchived?: boolean } = {},
): Promise<OperationType[]> {
  const supabase = await createClient();
  let query = supabase
    .from("operation_types")
    .select("id, name, code, is_external, is_inspection, is_cutting, archived_at")
    .eq("organization_id", organizationId);
  if (!options.includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    isExternal: row.is_external,
    isInspection: row.is_inspection,
    isCutting: row.is_cutting,
    archived: row.archived_at !== null,
  }));
}

export type ProductionSettings = { cycleTimeUnit: TimeUnit; inspectionMode: InspectionModeValue };

/** Organization-wide production settings (organizations.settings). */
export async function getProductionSettings(organizationId: string): Promise<ProductionSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  return {
    cycleTimeUnit: cycleUnitFromSettings(data.settings),
    inspectionMode: inspectionModeFromSettings(data.settings),
  };
}

export type MachineChoice = {
  id: string;
  code: string;
  name: string;
  cycleTimeUnit: TimeUnit | null;
};

/** Active machines with their cycle-time unit, for operation forms. */
export async function listMachineChoices(organizationId: string): Promise<MachineChoice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machines")
    .select("id, code, name, cycle_time_unit")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("code");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    cycleTimeUnit: asTimeUnit(row.cycle_time_unit),
  }));
}
