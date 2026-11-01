import "server-only";
import { addDecimals, compareDecimals, decimalFromDb } from "@/lib/decimal";
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
  /** Still to issue to released orders (D-032). */
  reserved: string;
  /** Stock − reserved (negative: planned orders need more than there is). */
  available: string;
};

export type StockItemRow = StockItem & StockItemTotals;

type TotalsRow = {
  item_id: string | null;
  quantity: number | null;
  mass_kg: number | null;
  own_quantity: number | null;
  own_mass_kg: number | null;
  own_value: number | null;
  reserved: number | null;
};

async function totalsByItem(
  organizationId: string,
  itemIds?: string[],
): Promise<Map<string, TotalsRow>> {
  const supabase = await createClient();
  let totals = supabase
    .from("stock_item_totals")
    .select("item_id, quantity, mass_kg, own_quantity, own_mass_kg, own_value")
    .eq("organization_id", organizationId);
  let reserved = supabase
    .from("stock_item_reserved")
    .select("item_id, reserved")
    .eq("organization_id", organizationId);
  if (itemIds) {
    totals = totals.in("item_id", itemIds);
    reserved = reserved.in("item_id", itemIds);
  }
  const [stock, claims] = await Promise.all([totals, reserved]);
  if (stock.error) throw stock.error;
  if (claims.error) throw claims.error;
  const reservedBy = new Map(claims.data.map((row) => [row.item_id ?? "", row.reserved]));
  const empty = { quantity: 0, mass_kg: 0, own_quantity: 0, own_mass_kg: 0, own_value: 0 };
  const ids = new Set([...stock.data.map((r) => r.item_id ?? ""), ...reservedBy.keys()]);
  const byId = new Map(stock.data.map((row) => [row.item_id ?? "", row]));
  return new Map(
    [...ids].map((id) => [
      id,
      { ...empty, ...byId.get(id), item_id: id, reserved: reservedBy.get(id) ?? 0 },
    ]),
  );
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
    reserved: dec(row?.reserved),
    available: addDecimals([dec(row?.quantity), `-${dec(row?.reserved)}`]),
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
  kind: "receipt" | "transfer_out" | "transfer_in" | "adjustment" | "issue" | "remnant" | "return";
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

// ---------------------------------------------------------------------------
// Material of production orders (D-032)
// ---------------------------------------------------------------------------

export type OrderMaterialPlan = {
  quantity: string | null;
  perPiece: string | null;
  pieceWidth: string | null;
  unitLength: string | null;
  unitWidth: string | null;
  piecesPerUnit: number | null;
  estimated: boolean;
  unitsNeeded: number | null;
  reportedPieces: string;
  proposedConsumption: string | null;
};

export type OrderIssueRow = {
  id: string;
  createdAt: string;
  kind: "issue" | "remnant" | "return";
  documentNumber: string;
  lotId: string;
  lotNumber: string;
  heatNumber: string | null;
  locationId: string;
  location: string;
  length: string | null;
  width: string | null;
  pieces: number | null;
  quantity: string;
  cutPieces: number | null;
};

export type OrderIssueBucket = StockBalanceRow & { ownerCustomerId: string | null };

export type OrderMaterial = {
  item: StockItem | null;
  plan: OrderMaterialPlan;
  reservation: { quantity: string; issued: string; remaining: string; shortage: string } | null;
  issued: string;
  returned: string;
  issuedValue: string;
  consumption: { quantity: string; proposed: string | null; note: string | null } | null;
  movements: OrderIssueRow[];
  /** Stock of the item the order may take (own and the order customer). */
  buckets: OrderIssueBucket[];
};

type PlanJson = {
  quantity?: number | null;
  per_piece?: number | null;
  piece_width?: number | null;
  unit_length?: number | null;
  unit_width?: number | null;
  pieces_per_unit?: number | null;
  estimated?: boolean | null;
  units_needed?: number | null;
  reported_pieces?: number | null;
  proposed_consumption?: number | null;
};

/** Everything the "Materijal" tab of an order shows (needs inventory.read). */
export async function getOrderMaterial(
  organizationId: string,
  orderId: string,
  stockItemId: string | null,
  customerId: string,
): Promise<OrderMaterial> {
  const supabase = await createClient();
  const [plan, coverage, issued, consumption, movements, items, locations] = await Promise.all([
    supabase.rpc("order_material_plan", { p_order_id: orderId }),
    supabase
      .from("stock_order_coverage")
      .select("quantity, issued, remaining, shortage")
      .eq("organization_id", organizationId)
      .eq("order_id", orderId)
      .maybeSingle(),
    supabase
      .from("stock_order_issued")
      .select("item_id, issued, returned, issued_value")
      .eq("organization_id", organizationId)
      .eq("order_id", orderId),
    stockItemId
      ? supabase
          .from("stock_order_consumption")
          .select("quantity, proposed_quantity, note")
          .eq("organization_id", organizationId)
          .eq("order_id", orderId)
          .eq("item_id", stockItemId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("stock_movements")
      .select(
        "id, created_at, kind, lot_id, location_id, length_mm, width_mm, pieces, quantity, cut_pieces, document:stock_documents(number), lot:stock_lots(lot_number, heat_number)",
      )
      .eq("organization_id", organizationId)
      .eq("production_order_id", orderId)
      .order("created_at", { ascending: false })
      .order("line_no"),
    stockItemId
      ? supabase
          .from("stock_items")
          .select(ITEM_SELECT)
          .eq("organization_id", organizationId)
          .eq("id", stockItemId)
          .returns<ItemRow[]>()
      : Promise.resolve({ data: [] as ItemRow[], error: null }),
    listStockLocations(organizationId),
  ]);
  if (plan.error) throw plan.error;
  if (coverage.error) throw coverage.error;
  if (issued.error) throw issued.error;
  if (consumption.error) throw consumption.error;
  if (movements.error) throw movements.error;
  if (items.error) throw items.error;

  const p = (plan.data ?? {}) as PlanJson;
  const locationLabel = new Map(locations.map((l) => [l.id, l.label]));
  const own = issued.data.find((row) => row.item_id === stockItemId);
  const itemRow = items.data?.[0];
  const buckets = stockItemId ? await orderBuckets(organizationId, stockItemId, customerId) : [];

  return {
    item: itemRow ? toItem(itemRow) : null,
    plan: {
      quantity: decimalFromDb(p.quantity),
      perPiece: decimalFromDb(p.per_piece),
      pieceWidth: decimalFromDb(p.piece_width),
      unitLength: decimalFromDb(p.unit_length),
      unitWidth: decimalFromDb(p.unit_width),
      piecesPerUnit: p.pieces_per_unit ?? null,
      estimated: p.estimated ?? false,
      unitsNeeded: p.units_needed ?? null,
      reportedPieces: dec(p.reported_pieces),
      proposedConsumption: decimalFromDb(p.proposed_consumption),
    },
    reservation: coverage.data
      ? {
          quantity: dec(coverage.data.quantity),
          issued: dec(coverage.data.issued),
          remaining: dec(coverage.data.remaining),
          shortage: dec(coverage.data.shortage),
        }
      : null,
    issued: dec(own?.issued),
    returned: dec(own?.returned),
    issuedValue: dec(own?.issued_value),
    consumption: consumption.data
      ? {
          quantity: dec(consumption.data.quantity),
          proposed: decimalFromDb(consumption.data.proposed_quantity),
          note: consumption.data.note,
        }
      : null,
    movements: movements.data.map((m) => ({
      id: m.id,
      createdAt: m.created_at,
      kind: m.kind as OrderIssueRow["kind"],
      documentNumber: m.document?.number ?? "",
      lotId: m.lot_id,
      lotNumber: m.lot?.lot_number ?? "",
      heatNumber: m.lot?.heat_number ?? null,
      locationId: m.location_id,
      location: locationLabel.get(m.location_id) ?? "",
      length: decimalFromDb(m.length_mm),
      width: decimalFromDb(m.width_mm),
      pieces: m.pieces,
      quantity: dec(m.quantity),
      cutPieces: m.cut_pieces,
    })),
    buckets,
  };
}

/** Positive buckets of the item: own material and material of the order customer. */
async function orderBuckets(
  organizationId: string,
  itemId: string,
  customerId: string,
): Promise<OrderIssueBucket[]> {
  const supabase = await createClient();
  const [balances, locations] = await Promise.all([
    supabase
      .from("stock_balances")
      .select("lot_id, location_id, length_mm, width_mm, pieces, quantity, mass_kg")
      .eq("organization_id", organizationId)
      .eq("item_id", itemId),
    listStockLocations(organizationId),
  ]);
  if (balances.error) throw balances.error;
  const lotIds = [...new Set(balances.data.map((b) => b.lot_id ?? ""))];
  if (lotIds.length === 0) return [];
  const lots = await supabase
    .from("stock_lots")
    .select("id, lot_number, heat_number, owner_customer_id, customer:customers(name)")
    .eq("organization_id", organizationId)
    .in("id", lotIds);
  if (lots.error) throw lots.error;
  const lotById = new Map(lots.data.map((lot) => [lot.id, lot]));
  const locationLabel = new Map(locations.map((l) => [l.id, l.label]));
  return balances.data
    .map((row) => {
      const lot = lotById.get(row.lot_id ?? "");
      return {
        lotId: row.lot_id ?? "",
        lotNumber: lot?.lot_number ?? "",
        heatNumber: lot?.heat_number ?? null,
        ownerCustomer: lot?.customer?.name ?? null,
        ownerCustomerId: lot?.owner_customer_id ?? null,
        locationId: row.location_id ?? "",
        location: locationLabel.get(row.location_id ?? "") ?? "",
        length: decimalFromDb(row.length_mm),
        width: decimalFromDb(row.width_mm),
        pieces: row.pieces,
        quantity: dec(row.quantity),
        mass: decimalFromDb(row.mass_kg),
      };
    })
    .filter((b) => b.ownerCustomerId === null || b.ownerCustomerId === customerId)
    .filter((b) => compareDecimals(b.quantity, "0") > 0);
}

export type ItemReservationRow = {
  orderId: string;
  orderNumber: string;
  customer: string;
  dueDate: string;
  quantity: string;
  issued: string;
  remaining: string;
  shortage: string;
};

/** Open reservations of an item, by due date. */
export async function listItemReservations(
  organizationId: string,
  itemId: string,
): Promise<ItemReservationRow[]> {
  const supabase = await createClient();
  const coverage = await supabase
    .from("stock_order_coverage")
    .select("order_id, quantity, issued, remaining, shortage")
    .eq("organization_id", organizationId)
    .eq("item_id", itemId);
  if (coverage.error) throw coverage.error;
  const orderIds = coverage.data.map((row) => row.order_id ?? "");
  if (orderIds.length === 0) return [];
  const orders = await supabase
    .from("production_orders")
    .select("id, order_number, due_date, customer:customers(name)")
    .eq("organization_id", organizationId)
    .in("id", orderIds);
  if (orders.error) throw orders.error;
  const orderById = new Map(orders.data.map((o) => [o.id, o]));
  return coverage.data
    .map((row) => {
      const order = orderById.get(row.order_id ?? "");
      return {
        orderId: row.order_id ?? "",
        orderNumber: order?.order_number ?? "",
        customer: order?.customer?.name ?? "",
        dueDate: order?.due_date ?? "",
        quantity: dec(row.quantity),
        issued: dec(row.issued),
        remaining: dec(row.remaining),
        shortage: dec(row.shortage),
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type FloorOrderMaterial = {
  itemCode: string;
  itemName: string;
  baseUnit: BaseUnit;
  lots: {
    lotNumber: string;
    heatNumber: string | null;
    length: string | null;
    width: string | null;
    pieces: number | null;
    quantity: string;
  }[];
};

type FloorMaterialJson = {
  item_code: string;
  item_name: string;
  base_unit: BaseUnit;
  lots: {
    lot_number: string;
    heat_number: string | null;
    length_mm: number | null;
    width_mm: number | null;
    pieces: number | null;
    quantity: number;
  }[];
};

/** Material issued to the order of an operation the caller sees (floor). */
export async function getFloorOrderMaterial(
  operationId: string,
): Promise<FloorOrderMaterial | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("floor_order_material", {
    p_operation_id: operationId,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as unknown as FloorMaterialJson;
  return {
    itemCode: row.item_code,
    itemName: row.item_name,
    baseUnit: row.base_unit,
    lots: row.lots.map((lot) => ({
      lotNumber: lot.lot_number,
      heatNumber: lot.heat_number,
      length: decimalFromDb(lot.length_mm),
      width: decimalFromDb(lot.width_mm),
      pieces: lot.pieces,
      quantity: dec(lot.quantity),
    })),
  };
}

// ---------------------------------------------------------------------------
// Stock counts (D-033)
// ---------------------------------------------------------------------------

export type StockCountStatus = "open" | "submitted" | "posted" | "cancelled";

export type StockCountRow = {
  id: string;
  number: string;
  status: StockCountStatus;
  location: string;
  itemLabel: string | null;
  createdAt: string;
  lines: number;
  counted: number;
};

export async function listStockCounts(organizationId: string): Promise<StockCountRow[]> {
  const supabase = await createClient();
  const [counts, locations] = await Promise.all([
    supabase
      .from("stock_counts")
      .select(
        "id, number, status, location_id, created_at, item:stock_items(code, name), stock_count_lines(counted_quantity)",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100),
    listStockLocations(organizationId),
  ]);
  if (counts.error) throw counts.error;
  const locationLabel = new Map(locations.map((l) => [l.id, l.label]));
  return counts.data.map((c) => ({
    id: c.id,
    number: c.number,
    status: c.status as StockCountStatus,
    location: locationLabel.get(c.location_id) ?? "",
    itemLabel: c.item ? `${c.item.code} · ${c.item.name}` : null,
    createdAt: c.created_at,
    lines: c.stock_count_lines.length,
    counted: c.stock_count_lines.filter((l) => l.counted_quantity !== null).length,
  }));
}

export type StockCountLine = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  baseUnit: BaseUnit;
  lotNumber: string | null;
  heatNumber: string | null;
  location: string;
  length: string | null;
  width: string | null;
  expectedPieces: number | null;
  expectedQuantity: string;
  countedPieces: number | null;
  countedQuantity: string | null;
  found: boolean;
};

export type StockCountDetail = {
  id: string;
  number: string;
  status: StockCountStatus;
  locationId: string;
  location: string;
  itemId: string | null;
  notes: string | null;
  decisionNote: string | null;
  adjustmentDocumentId: string | null;
  createdAt: string;
  lines: StockCountLine[];
  /** Locations of the count (the location and its shelves) for found lines. */
  locations: StockLocation[];
};

export async function getStockCount(
  organizationId: string,
  countId: string,
): Promise<StockCountDetail | null> {
  const supabase = await createClient();
  const [count, locations] = await Promise.all([
    supabase
      .from("stock_counts")
      .select(
        "id, number, status, location_id, item_id, notes, decision_note, adjustment_document_id, created_at, stock_count_lines(id, item_id, location_id, length_mm, width_mm, expected_pieces, expected_quantity, counted_pieces, counted_quantity, found, item:stock_items(code, name, base_unit), lot:stock_lots(lot_number, heat_number))",
      )
      .eq("organization_id", organizationId)
      .eq("id", countId)
      .maybeSingle(),
    listStockLocations(organizationId),
  ]);
  if (count.error) throw count.error;
  if (!count.data) return null;
  const c = count.data;
  const locationLabel = new Map(locations.map((l) => [l.id, l.label]));
  return {
    id: c.id,
    number: c.number,
    status: c.status as StockCountStatus,
    locationId: c.location_id,
    location: locationLabel.get(c.location_id) ?? "",
    itemId: c.item_id,
    notes: c.notes,
    decisionNote: c.decision_note,
    adjustmentDocumentId: c.adjustment_document_id,
    createdAt: c.created_at,
    locations: locations.filter(
      (l) => !l.archived && (l.id === c.location_id || l.parentId === c.location_id),
    ),
    lines: c.stock_count_lines
      .map((l) => ({
        id: l.id,
        itemId: l.item_id,
        itemCode: l.item?.code ?? "",
        itemName: l.item?.name ?? "",
        baseUnit: (l.item?.base_unit ?? "kg") as BaseUnit,
        lotNumber: l.lot?.lot_number ?? null,
        heatNumber: l.lot?.heat_number ?? null,
        location: locationLabel.get(l.location_id) ?? "",
        length: decimalFromDb(l.length_mm),
        width: decimalFromDb(l.width_mm),
        expectedPieces: l.expected_pieces,
        expectedQuantity: dec(l.expected_quantity),
        countedPieces: l.counted_pieces,
        countedQuantity: decimalFromDb(l.counted_quantity),
        found: l.found,
      }))
      .sort(
        (a, b) =>
          a.location.localeCompare(b.location, "bs") ||
          a.itemCode.localeCompare(b.itemCode, "bs") ||
          (a.lotNumber ?? "").localeCompare(b.lotNumber ?? "") ||
          Number(b.length ?? 0) - Number(a.length ?? 0),
      ),
  };
}

// ---------------------------------------------------------------------------
// Warnings (dashboard, order list)
// ---------------------------------------------------------------------------

export type OrderShortage = {
  orderId: string;
  orderNumber: string;
  dueDate: string;
  itemCode: string;
  baseUnit: BaseUnit;
  shortage: string;
};

/** Released orders that lack material, by due date. */
export async function listOrderShortages(organizationId: string): Promise<OrderShortage[]> {
  const supabase = await createClient();
  const coverage = await supabase
    .from("stock_order_coverage")
    .select("order_id, item_id, shortage")
    .eq("organization_id", organizationId)
    .gt("shortage", 0);
  if (coverage.error) throw coverage.error;
  if (coverage.data.length === 0) return [];
  const [orders, items] = await Promise.all([
    supabase
      .from("production_orders")
      .select("id, order_number, due_date")
      .eq("organization_id", organizationId)
      .in(
        "id",
        coverage.data.map((row) => row.order_id ?? ""),
      ),
    supabase
      .from("stock_items")
      .select("id, code, base_unit")
      .eq("organization_id", organizationId)
      .in(
        "id",
        coverage.data.map((row) => row.item_id ?? ""),
      ),
  ]);
  if (orders.error) throw orders.error;
  if (items.error) throw items.error;
  const orderById = new Map(orders.data.map((o) => [o.id, o]));
  const itemById = new Map(items.data.map((i) => [i.id, i]));
  return coverage.data
    .map((row) => {
      const order = orderById.get(row.order_id ?? "");
      const item = itemById.get(row.item_id ?? "");
      return {
        orderId: row.order_id ?? "",
        orderNumber: order?.order_number ?? "",
        dueDate: order?.due_date ?? "",
        itemCode: item?.code ?? "",
        baseUnit: (item?.base_unit ?? "mm") as BaseUnit,
        shortage: dec(row.shortage),
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Order ids (of the given ones) that lack material. */
export async function ordersShortOfMaterial(
  organizationId: string,
  orderIds: string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_order_coverage")
    .select("order_id")
    .eq("organization_id", organizationId)
    .in("order_id", orderIds)
    .gt("shortage", 0);
  if (error) throw error;
  return new Set(data.map((row) => row.order_id ?? ""));
}

export async function countSubmittedStockCounts(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("stock_counts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "submitted");
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Labels and the mobile warehouse
// ---------------------------------------------------------------------------

export type LotView = {
  lotId: string;
  lotNumber: string;
  heatNumber: string | null;
  ownerCustomer: string | null;
  itemId: string;
};

export async function getLot(organizationId: string, lotId: string): Promise<LotView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_lots")
    .select("id, lot_number, heat_number, item_id, customer:customers(name)")
    .eq("organization_id", organizationId)
    .eq("id", lotId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    lotId: data.id,
    lotNumber: data.lot_number,
    heatNumber: data.heat_number,
    ownerCustomer: data.customer?.name ?? null,
    itemId: data.item_id,
  };
}

export type LocationStockRow = StockBalanceRow & {
  itemId: string;
  itemCode: string;
  itemName: string;
  baseUnit: BaseUnit;
};

/** Stock at one location (with its shelves for a warehouse). */
export async function listLocationStock(
  organizationId: string,
  locationId: string,
): Promise<LocationStockRow[]> {
  const supabase = await createClient();
  const locations = await listStockLocations(organizationId);
  const ids = locations
    .filter((l) => l.id === locationId || l.parentId === locationId)
    .map((l) => l.id);
  if (ids.length === 0) return [];
  const balances = await supabase
    .from("stock_balances")
    .select("item_id, lot_id, location_id, length_mm, width_mm, pieces, quantity, mass_kg")
    .eq("organization_id", organizationId)
    .in("location_id", ids)
    .gt("quantity", 0);
  if (balances.error) throw balances.error;
  const itemIds = [...new Set(balances.data.map((b) => b.item_id ?? ""))];
  const lotIds = [...new Set(balances.data.map((b) => b.lot_id ?? ""))];
  if (itemIds.length === 0) return [];
  const [items, lots] = await Promise.all([
    supabase.from("stock_items").select("id, code, name, base_unit").in("id", itemIds),
    supabase
      .from("stock_lots")
      .select("id, lot_number, heat_number, customer:customers(name)")
      .in("id", lotIds),
  ]);
  if (items.error) throw items.error;
  if (lots.error) throw lots.error;
  const itemById = new Map(items.data.map((i) => [i.id, i]));
  const lotById = new Map(lots.data.map((l) => [l.id, l]));
  const label = new Map(locations.map((l) => [l.id, l.label]));
  return balances.data
    .map((b) => {
      const item = itemById.get(b.item_id ?? "");
      const lot = lotById.get(b.lot_id ?? "");
      return {
        itemId: b.item_id ?? "",
        itemCode: item?.code ?? "",
        itemName: item?.name ?? "",
        baseUnit: (item?.base_unit ?? "kg") as BaseUnit,
        lotId: b.lot_id ?? "",
        lotNumber: lot?.lot_number ?? "",
        heatNumber: lot?.heat_number ?? null,
        ownerCustomer: lot?.customer?.name ?? null,
        locationId: b.location_id ?? "",
        location: label.get(b.location_id ?? "") ?? "",
        length: decimalFromDb(b.length_mm),
        width: decimalFromDb(b.width_mm),
        pieces: b.pieces,
        quantity: dec(b.quantity),
        mass: decimalFromDb(b.mass_kg),
      };
    })
    .sort(
      (a, b) =>
        a.location.localeCompare(b.location, "bs") || a.itemCode.localeCompare(b.itemCode, "bs"),
    );
}
