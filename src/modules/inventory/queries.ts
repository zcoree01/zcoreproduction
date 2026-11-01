import "server-only";
import { addDecimals, decimalFromDb } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import {
  averageCostPerKg,
  dimensionLabel,
  inventorySettingsFrom,
  isBelowMinimum,
  kgPerUnit,
  type BaseUnit,
  type InventorySettings,
  type RevisionBlank,
  type StockShape,
} from "./rules";
import type { LocationKind } from "./schemas";

const dec = (value: number | string | null | undefined) => decimalFromDb(value) ?? "0";

// ---------------------------------------------------------------------------
// Settings and locations
// ---------------------------------------------------------------------------

export async function getInventorySettings(organizationId: string): Promise<InventorySettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .single();
  if (error) throw error;
  return inventorySettingsFrom(data.settings);
}

export type StockLocation = {
  id: string;
  kind: LocationKind;
  code: string;
  name: string;
  parentId: string | null;
  machineId: string | null;
  machineName: string | null;
  archived: boolean;
  /** "M1 / P3 — Polica 3" style label for pickers. */
  label: string;
};

export async function listStockLocations(organizationId: string): Promise<StockLocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_locations")
    .select("id, kind, code, name, parent_id, machine_id, archived_at, machine:machines(name)")
    .eq("organization_id", organizationId)
    .order("code");
  if (error) throw error;

  const byId = new Map(data.map((row) => [row.id, row]));
  return data
    .map((row) => {
      const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
      return {
        id: row.id,
        kind: row.kind as LocationKind,
        code: row.code,
        name: row.name,
        parentId: row.parent_id,
        machineId: row.machine_id,
        machineName: row.machine?.name ?? null,
        archived: row.archived_at !== null,
        label: `${parent ? `${parent.code} / ` : ""}${row.code} — ${row.name}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "bs"));
}

// ---------------------------------------------------------------------------
// Stock items
// ---------------------------------------------------------------------------

type ItemRow = {
  id: string;
  code: string;
  name: string;
  material_id: string | null;
  shape: string;
  diameter_mm: number | null;
  width_mm: number | null;
  thickness_mm: number | null;
  profile_label: string | null;
  base_unit: string;
  standard_length_mm: number | null;
  standard_width_mm: number | null;
  mass_per_m_kg: number | null;
  supplier: string | null;
  min_stock: number | null;
  default_location_id: string | null;
  notes: string | null;
  archived_at: string | null;
  material: {
    designation: string;
    density_kg_dm3: number | null;
    group: { density_kg_dm3: number | null } | null;
  } | null;
};

const ITEM_SELECT =
  "id, code, name, material_id, shape, diameter_mm, width_mm, thickness_mm, profile_label, base_unit, standard_length_mm, standard_width_mm, mass_per_m_kg, supplier, min_stock, default_location_id, notes, archived_at, material:materials(designation, density_kg_dm3, group:material_groups(density_kg_dm3))";

export type StockItem = {
  id: string;
  code: string;
  name: string;
  materialId: string | null;
  grade: string | null;
  density: string | null;
  shape: StockShape;
  diameter: string | null;
  width: string | null;
  thickness: string | null;
  profileLabel: string | null;
  baseUnit: BaseUnit;
  standardLength: string | null;
  standardWidth: string | null;
  massPerM: string | null;
  supplier: string | null;
  minStock: string | null;
  defaultLocationId: string | null;
  notes: string | null;
  archived: boolean;
  dimension: string;
  /** kg per base unit (null when unknown). */
  kgPerUnit: string | null;
};

function toItem(row: ItemRow): StockItem {
  const density =
    decimalFromDb(row.material?.density_kg_dm3) ??
    decimalFromDb(row.material?.group?.density_kg_dm3);
  const geometry = {
    shape: row.shape as StockShape,
    baseUnit: row.base_unit as BaseUnit,
    diameter: decimalFromDb(row.diameter_mm),
    width: decimalFromDb(row.width_mm),
    thickness: decimalFromDb(row.thickness_mm),
    massPerM: decimalFromDb(row.mass_per_m_kg),
  };
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    materialId: row.material_id,
    grade: row.material?.designation ?? null,
    density,
    ...geometry,
    profileLabel: row.profile_label,
    standardLength: decimalFromDb(row.standard_length_mm),
    standardWidth: decimalFromDb(row.standard_width_mm),
    supplier: row.supplier,
    minStock: decimalFromDb(row.min_stock),
    defaultLocationId: row.default_location_id,
    notes: row.notes,
    archived: row.archived_at !== null,
    dimension: dimensionLabel({ ...geometry, profileLabel: row.profile_label }),
    kgPerUnit: kgPerUnit(geometry, density),
  };
}

export type StockItemTotals = {
  quantity: string;
  mass: string;
  ownQuantity: string;
  ownMass: string;
  ownValue: string;
  costPerKg: string | null;
  belowMinimum: boolean;
};

export type StockItemRow = StockItem & StockItemTotals;

type TotalsRow = {
  item_id: string | null;
  quantity: number | null;
  mass_kg: number | null;
  own_quantity: number | null;
  own_mass_kg: number | null;
  own_value: number | null;
};

async function totalsByItem(
  organizationId: string,
  itemIds?: string[],
): Promise<Map<string, TotalsRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("stock_item_totals")
    .select("item_id, quantity, mass_kg, own_quantity, own_mass_kg, own_value")
    .eq("organization_id", organizationId);
  if (itemIds) query = query.in("item_id", itemIds);
  const { data, error } = await query;
  if (error) throw error;
  return new Map(data.map((row) => [row.item_id ?? "", row]));
}

function withTotals(item: StockItem, totals: Map<string, TotalsRow>): StockItemRow {
  const row = totals.get(item.id);
  const ownQuantity = dec(row?.own_quantity);
  const ownMass = dec(row?.own_mass_kg);
  const ownValue = dec(row?.own_value);
  return {
    ...item,
    quantity: dec(row?.quantity),
    mass: dec(row?.mass_kg),
    ownQuantity,
    ownMass,
    ownValue,
    costPerKg: averageCostPerKg({ ownMass, ownValue }),
    belowMinimum: !item.archived && isBelowMinimum(ownQuantity, item.minStock),
  };
}

/** All items with their stock (active first), for the warehouse list. */
export async function listStockItems(organizationId: string): Promise<StockItemRow[]> {
  const supabase = await createClient();
  const [items, totals] = await Promise.all([
    supabase
      .from("stock_items")
      .select(ITEM_SELECT)
      .eq("organization_id", organizationId)
      .order("code")
      .returns<ItemRow[]>(),
    totalsByItem(organizationId),
  ]);
  if (items.error) throw items.error;
  return items.data
    .map((row) => withTotals(toItem(row), totals))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.code.localeCompare(b.code, "bs"));
}

/** Active items for pickers (receipt lines, pairing). */
export async function listStockItemOptions(organizationId: string): Promise<StockItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_items")
    .select(ITEM_SELECT)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("code")
    .returns<ItemRow[]>();
  if (error) throw error;
  return data.map(toItem);
}

export type StockBalanceRow = {
  lotId: string;
  lotNumber: string;
  heatNumber: string | null;
  ownerCustomer: string | null;
  locationId: string;
  location: string;
  length: string | null;
  width: string | null;
  pieces: number | null;
  quantity: string;
  mass: string | null;
};

export type StockMovementRow = {
  id: string;
  createdAt: string;
  kind: "receipt" | "transfer_out" | "transfer_in" | "adjustment";
  documentNumber: string;
  lotNumber: string;
  location: string;
  length: string | null;
  width: string | null;
  pieces: number | null;
  quantity: string;
  mass: string | null;
  value: string;
  actor: string | null;
};

export type StockLotRow = {
  id: string;
  lotNumber: string;
  heatNumber: string | null;
  supplier: string | null;
  deliveryNote: string | null;
  ownerCustomer: string | null;
  receivedAt: string;
  certificates: { id: string; fileName: string; storagePath: string; createdAt: string }[];
};

export type StockItemDetail = {
  item: StockItemRow;
  balances: StockBalanceRow[];
  movements: StockMovementRow[];
  lots: StockLotRow[];
};

const MOVEMENT_LIMIT = 200;

export async function getStockItemDetail(
  organizationId: string,
  itemId: string,
): Promise<StockItemDetail | null> {
  const supabase = await createClient();
  const itemResult = await supabase
    .from("stock_items")
    .select(ITEM_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", itemId)
    .returns<ItemRow[]>()
    .maybeSingle();
  if (itemResult.error) throw itemResult.error;
  if (!itemResult.data) return null;

  const [totals, balances, movements, lots, locations] = await Promise.all([
    totalsByItem(organizationId, [itemId]),
    supabase
      .from("stock_balances")
      .select("lot_id, location_id, length_mm, width_mm, pieces, quantity, mass_kg")
      .eq("organization_id", organizationId)
      .eq("item_id", itemId),
    supabase
      .from("stock_movements")
      .select(
        "id, created_at, kind, lot_id, location_id, length_mm, width_mm, pieces, quantity, mass_kg, value, created_by, document:stock_documents(number)",
      )
      .eq("organization_id", organizationId)
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .order("line_no", { ascending: false })
      .limit(MOVEMENT_LIMIT),
    supabase
      .from("stock_lots")
      .select(
        "id, lot_number, heat_number, supplier, delivery_note, received_at, customer:customers(name), stock_lot_certificates(id, file_name, storage_path, created_at, archived_at)",
      )
      .eq("organization_id", organizationId)
      .eq("item_id", itemId)
      .order("received_at", { ascending: false }),
    listStockLocations(organizationId),
  ]);
  if (balances.error) throw balances.error;
  if (movements.error) throw movements.error;
  if (lots.error) throw lots.error;

  const locationLabel = new Map(locations.map((l) => [l.id, l.label]));
  const lotById = new Map(lots.data.map((lot) => [lot.id, lot]));
  const actorIds = [
    ...new Set(movements.data.map((m) => m.created_by).filter((id) => id !== null)),
  ];
  const actors = await memberNames(organizationId, actorIds);

  return {
    item: withTotals(toItem(itemResult.data), totals),
    balances: balances.data
      .map((row) => {
        const lot = lotById.get(row.lot_id ?? "");
        return {
          lotId: row.lot_id ?? "",
          lotNumber: lot?.lot_number ?? "",
          heatNumber: lot?.heat_number ?? null,
          ownerCustomer: lot?.customer?.name ?? null,
          locationId: row.location_id ?? "",
          location: locationLabel.get(row.location_id ?? "") ?? "",
          length: decimalFromDb(row.length_mm),
          width: decimalFromDb(row.width_mm),
          pieces: row.pieces,
          quantity: dec(row.quantity),
          mass: decimalFromDb(row.mass_kg),
        };
      })
      .sort(
        (a, b) =>
          a.location.localeCompare(b.location, "bs") ||
          a.lotNumber.localeCompare(b.lotNumber) ||
          Number(b.length ?? 0) - Number(a.length ?? 0),
      ),
    movements: movements.data.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      kind: row.kind as StockMovementRow["kind"],
      documentNumber: row.document?.number ?? "",
      lotNumber: lotById.get(row.lot_id)?.lot_number ?? "",
      location: locationLabel.get(row.location_id) ?? "",
      length: decimalFromDb(row.length_mm),
      width: decimalFromDb(row.width_mm),
      pieces: row.pieces,
      quantity: dec(row.quantity),
      mass: decimalFromDb(row.mass_kg),
      value: dec(row.value),
      actor: row.created_by ? (actors.get(row.created_by) ?? null) : null,
    })),
    lots: lots.data.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lot_number,
      heatNumber: lot.heat_number,
      supplier: lot.supplier,
      deliveryNote: lot.delivery_note,
      ownerCustomer: lot.customer?.name ?? null,
      receivedAt: lot.received_at,
      certificates: lot.stock_lot_certificates
        .filter((c) => c.archived_at === null)
        .map((c) => ({
          id: c.id,
          fileName: c.file_name,
          storagePath: c.storage_path,
          createdAt: c.created_at,
        })),
    })),
  };
}

/** Full names of members by user id (member directory). */
async function memberNames(organizationId: string, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_directory")
    .select("user_id, full_name")
    .eq("organization_id", organizationId)
    .in("user_id", userIds);
  if (error) throw error;
  return new Map(
    data.flatMap((row) => (row.user_id ? [[row.user_id, row.full_name ?? ""] as const] : [])),
  );
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export type AdjustmentDocument = {
  id: string;
  number: string;
  status: "pending" | "posted" | "rejected";
  reason: string;
  createdAt: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  lines: {
    itemId: string;
    itemCode: string;
    itemName: string;
    baseUnit: BaseUnit;
    lotNumber: string | null;
    location: string;
    length: string | null;
    width: string | null;
    pieces: number | null;
    quantity: string | null;
  }[];
};

/** Pending corrections first, then the latest decided ones. */
export async function listAdjustments(organizationId: string): Promise<AdjustmentDocument[]> {
  const supabase = await createClient();
  const [docs, locations] = await Promise.all([
    supabase
      .from("stock_documents")
      .select(
        "id, number, status, reason, created_at, created_by, decided_by, decision_note, stock_adjustment_lines(line_no, item_id, length_mm, width_mm, pieces, quantity, location_id, item:stock_items(code, name, base_unit), lot:stock_lots(lot_number))",
      )
      .eq("organization_id", organizationId)
      .eq("kind", "adjustment")
      .order("created_at", { ascending: false })
      .limit(100),
    listStockLocations(organizationId),
  ]);
  if (docs.error) throw docs.error;

  const locationLabel = new Map(locations.map((l) => [l.id, l.label]));
  const names = await memberNames(organizationId, [
    ...new Set(docs.data.flatMap((d) => [d.created_by, d.decided_by]).filter((id) => id !== null)),
  ]);

  return docs.data
    .map((doc) => ({
      id: doc.id,
      number: doc.number,
      status: doc.status as AdjustmentDocument["status"],
      reason: doc.reason ?? "",
      createdAt: doc.created_at,
      requestedBy: doc.created_by ? (names.get(doc.created_by) ?? null) : null,
      decidedBy: doc.decided_by ? (names.get(doc.decided_by) ?? null) : null,
      decisionNote: doc.decision_note,
      lines: [...doc.stock_adjustment_lines]
        .sort((a, b) => a.line_no - b.line_no)
        .map((line) => ({
          itemId: line.item_id,
          itemCode: line.item?.code ?? "",
          itemName: line.item?.name ?? "",
          baseUnit: (line.item?.base_unit ?? "kg") as BaseUnit,
          lotNumber: line.lot?.lot_number ?? null,
          location: locationLabel.get(line.location_id) ?? "",
          length: decimalFromDb(line.length_mm),
          width: decimalFromDb(line.width_mm),
          pieces: line.pieces,
          quantity: decimalFromDb(line.quantity),
        })),
    }))
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
}

export async function countPendingAdjustments(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("stock_documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("kind", "adjustment")
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Receipt history
// ---------------------------------------------------------------------------

export type ReceiptRow = {
  id: string;
  number: string;
  documentDate: string;
  supplier: string | null;
  deliveryNote: string | null;
  lines: number;
  value: string;
};

export async function listReceipts(organizationId: string): Promise<ReceiptRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_documents")
    .select("id, number, document_date, supplier, delivery_note, stock_movements(value)")
    .eq("organization_id", organizationId)
    .eq("kind", "receipt")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map((doc) => ({
    id: doc.id,
    number: doc.number,
    documentDate: doc.document_date,
    supplier: doc.supplier,
    deliveryNote: doc.delivery_note,
    lines: doc.stock_movements.length,
    value: addDecimals(
      doc.stock_movements.map((m) => dec(m.value)),
      4,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Pairing products with stock items
// ---------------------------------------------------------------------------

export type PairingRevision = RevisionBlank & {
  revisionId: string;
  productId: string;
  partNumber: string;
  productName: string;
  revision: string | null;
  grade: string | null;
  stockItemId: string | null;
};

/** Current revisions of active products with their raw piece and link. */
export async function listPairingRevisions(organizationId: string): Promise<PairingRevision[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_revisions")
    .select(
      "id, revision, material_id, blank_geometry, blank_diameter_mm, blank_width_mm, blank_thickness_mm, stock_item_id, product:products!inner(id, part_number, name, archived_at), material:materials(designation)",
    )
    .eq("organization_id", organizationId)
    .eq("is_current", true)
    .is("product.archived_at", null);
  if (error) throw error;
  return data
    .map((row) => ({
      revisionId: row.id,
      productId: row.product.id,
      partNumber: row.product.part_number,
      productName: row.product.name,
      revision: row.revision,
      grade: row.material?.designation ?? null,
      materialId: row.material_id,
      geometry: row.blank_geometry as RevisionBlank["geometry"],
      diameter: decimalFromDb(row.blank_diameter_mm),
      width: decimalFromDb(row.blank_width_mm),
      thickness: decimalFromDb(row.blank_thickness_mm),
      stockItemId: row.stock_item_id,
    }))
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber, "bs"));
}
