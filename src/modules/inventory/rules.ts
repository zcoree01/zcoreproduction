import { addDecimals, compareDecimals, divideDecimal, multiplyDecimal } from "@/lib/decimal";

// Domain rules of the material warehouse (D-031). The database functions are
// authoritative (post_stock_receipt, stock_item_kg_per_unit …); these mirror
// them for previews in forms and are unit-tested against the same examples.

export const STOCK_SHAPES = [
  "round_bar",
  "hex_bar",
  "square_bar",
  "flat_bar",
  "tube",
  "profile",
  "sheet",
  "plate",
  "other",
] as const;
export type StockShape = (typeof STOCK_SHAPES)[number];

export const BASE_UNITS = ["mm", "m2", "kg", "pcs"] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export type StockDimension = "diameter" | "width" | "thickness";

/** Dimensions each shape requires (mirrors stock_items_dimensions_check). */
export const SHAPE_DIMENSIONS: Record<StockShape, readonly StockDimension[]> = {
  round_bar: ["diameter"],
  hex_bar: ["diameter"],
  square_bar: ["width"],
  flat_bar: ["width", "thickness"],
  tube: ["diameter", "thickness"],
  profile: [],
  sheet: ["thickness"],
  plate: ["thickness"],
  other: [],
};

const LENGTH_SHAPES: readonly StockShape[] = [
  "round_bar",
  "hex_bar",
  "square_bar",
  "flat_bar",
  "tube",
  "profile",
];
const AREA_SHAPES: readonly StockShape[] = ["sheet", "plate"];

/** Base units allowed for a shape (mirrors stock_items_unit_check). */
export function baseUnitsForShape(shape: StockShape): readonly BaseUnit[] {
  if (LENGTH_SHAPES.includes(shape)) return ["mm"];
  if (AREA_SHAPES.includes(shape)) return ["m2"];
  return ["kg", "pcs"];
}

/** Stock of these units is kept as pieces of a given size. */
export function isDimensionedUnit(unit: BaseUnit): unit is "mm" | "m2" {
  return unit === "mm" || unit === "m2";
}

export type StockItemGeometry = {
  shape: StockShape;
  baseUnit: BaseUnit;
  diameter: string | null;
  width: string | null;
  thickness: string | null;
  massPerM: string | null;
};

const PI = "3.14159265358979";
const HALF_SQRT3 = "0.866025403784439";
const SCALE = 12;
const times = (a: string, b: string) => multiplyDecimal(a, b, SCALE);

/** Cross-section in mm² of a bar or tube, or null for other shapes. */
export function stockCrossSection(item: StockItemGeometry): string | null {
  const { diameter: d, width: w, thickness: t } = item;
  switch (item.shape) {
    case "round_bar":
      return d ? times(divideDecimal(PI, "4", SCALE), times(d, d)) : null;
    case "hex_bar":
      return d ? times(HALF_SQRT3, times(d, d)) : null;
    case "square_bar":
      return w ? times(w, w) : null;
    case "flat_bar":
      return w && t ? times(w, t) : null;
    case "tube":
      return d && t ? times(PI, times(t, addDecimals([d, `-${t}`], SCALE))) : null;
    default:
      return null;
  }
}

/**
 * kg per base unit (mirrors private.stock_item_kg_per_unit): per mm for bars,
 * tubes and profiles (kg/m from the supplier table wins), per m² for sheets
 * and plates (thickness × density), 1 for kg, null for pieces or when the
 * density is unknown.
 */
export function kgPerUnit(item: StockItemGeometry, densityKgDm3: string | null): string | null {
  if (item.baseUnit === "kg") return "1";
  if (item.baseUnit === "pcs") return null;
  if (item.baseUnit === "mm" && item.massPerM) return divideDecimal(item.massPerM, "1000", SCALE);
  if (!densityKgDm3) return null;
  if (item.baseUnit === "m2") return item.thickness ? times(item.thickness, densityKgDm3) : null;
  const area = stockCrossSection(item);
  return area ? divideDecimal(times(area, densityKgDm3), "1000000", SCALE) : null;
}

/** kg per metre of a length item, for display (4 decimals). */
export function kgPerMetre(item: StockItemGeometry, densityKgDm3: string | null): string | null {
  if (item.baseUnit !== "mm") return null;
  const perMm = kgPerUnit(item, densityKgDm3);
  return perMm ? divideDecimal(times(perMm, "1000"), "1", 4) : null;
}

export type StockLine = {
  pieces: number | null;
  length: string | null;
  width: string | null;
  quantity: string | null;
};

/**
 * Quantity of a line in the base unit (mirrors private.stock_line_quantity):
 * pieces × length (mm), pieces × length × width / 10⁶ (m², 6 decimals), or
 * the quantity itself (kg, pcs). Null when the line does not fit the unit.
 */
export function lineQuantity(unit: BaseUnit, line: StockLine): string | null {
  if (unit === "mm") {
    if (!line.pieces || !line.length || line.width) return null;
    return times(String(line.pieces), line.length);
  }
  if (unit === "m2") {
    if (!line.pieces || !line.length || !line.width) return null;
    return divideDecimal(times(String(line.pieces), times(line.length, line.width)), "1000000", 6);
  }
  if (line.pieces !== null || line.length || line.width || !line.quantity) return null;
  if (unit === "pcs" && line.quantity.includes(".")) return null;
  return line.quantity;
}

/** Theoretical mass of a quantity (4 decimals), or null when unknown. */
export function lineMass(quantity: string, perUnit: string | null): string | null {
  return perUnit ? divideDecimal(times(quantity, perUnit), "1", 4) : null;
}

export const PRICE_UNITS = ["kg", "m", "m2", "piece"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** Price units that make sense for a base unit (first = default). */
export function priceUnitsFor(unit: BaseUnit): readonly PriceUnit[] {
  switch (unit) {
    case "mm":
      return ["kg", "m", "piece"];
    case "m2":
      return ["kg", "m2", "piece"];
    case "kg":
      return ["kg"];
    case "pcs":
      return ["piece", "kg"];
  }
}

export type ReceiptValueInput = {
  unit: BaseUnit;
  quantity: string;
  pieces: number | null;
  mass: string | null;
  unitPrice: string;
  priceUnit: PriceUnit;
  invoiceKg: string | null;
  includesVat: boolean;
  vatRate: string;
};

/**
 * Net value of a receipt line (mirrors post_stock_receipt): unit price ×
 * basis (kg: invoice kg, else theoretical mass; m; m²; pieces), 4 decimals,
 * then without VAT when the price includes it. Null when the price unit does
 * not fit the item (no basis).
 */
export function receiptLineValue(input: ReceiptValueInput): string | null {
  const basis = priceBasis(input);
  if (basis === null) return null;
  const gross = divideDecimal(times(input.unitPrice, basis), "1", 4);
  if (!input.includesVat) return gross;
  return divideDecimal(times(gross, "100"), addDecimals(["100", input.vatRate], SCALE), 4);
}

function priceBasis(input: ReceiptValueInput): string | null {
  switch (input.priceUnit) {
    case "kg":
      return input.invoiceKg ?? input.mass;
    case "m":
      return input.unit === "mm" ? divideDecimal(input.quantity, "1000", 6) : null;
    case "m2":
      return input.unit === "m2" ? input.quantity : null;
    case "piece":
      if (isDimensionedUnit(input.unit)) return input.pieces === null ? null : String(input.pieces);
      return input.unit === "pcs" ? input.quantity : null;
  }
}

export type LedgerMovement = {
  itemId: string;
  lotId: string;
  locationId: string;
  length: string | null;
  width: string | null;
  pieces: number | null;
  quantity: string;
  mass: string | null;
  value: string;
  customerOwned: boolean;
};

export type StockBucket = {
  itemId: string;
  lotId: string;
  locationId: string;
  length: string | null;
  width: string | null;
  pieces: number | null;
  quantity: string;
};

/** Balances as sums of movements per item, lot, location and piece size (mirrors stock_balances). */
export function balancesFromMovements(movements: readonly LedgerMovement[]): StockBucket[] {
  const buckets = new Map<string, StockBucket>();
  for (const m of movements) {
    const key = [m.itemId, m.lotId, m.locationId, m.length ?? "", m.width ?? ""].join("|");
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.quantity = addDecimals([bucket.quantity, m.quantity]);
      bucket.pieces = m.pieces === null ? bucket.pieces : (bucket.pieces ?? 0) + m.pieces;
    } else {
      buckets.set(key, {
        itemId: m.itemId,
        lotId: m.lotId,
        locationId: m.locationId,
        length: m.length,
        width: m.width,
        pieces: m.pieces,
        quantity: m.quantity,
      });
    }
  }
  return [...buckets.values()].filter((b) => compareDecimals(b.quantity, "0") !== 0);
}

/** True when any bucket would end below zero (the database refuses such documents). */
export function hasNegativeBucket(buckets: readonly StockBucket[]): boolean {
  return buckets.some((b) => compareDecimals(b.quantity, "0") < 0 || (b.pieces ?? 0) < 0);
}

export type ItemTotals = {
  quantity: string;
  ownQuantity: string;
  ownMass: string;
  ownValue: string;
};

/** Totals of one item (mirrors stock_item_totals); customer lots carry no value. */
export function itemTotals(movements: readonly LedgerMovement[]): ItemTotals {
  const own = movements.filter((m) => !m.customerOwned);
  return {
    quantity: addDecimals(movements.map((m) => m.quantity)),
    ownQuantity: addDecimals(own.map((m) => m.quantity)),
    ownMass: addDecimals(own.map((m) => m.mass ?? "0")),
    ownValue: addDecimals(own.map((m) => m.value)),
  };
}

/**
 * Moving weighted average cost per base unit: own value / own quantity
 * (mirrors private.stock_unit_cost while own stock exists). Outgoing
 * movements valued at this cost leave it unchanged; receipts move it.
 */
export function averageUnitCost(totals: Pick<ItemTotals, "ownQuantity" | "ownValue">) {
  if (compareDecimals(totals.ownQuantity, "0") <= 0) return null;
  return divideDecimal(totals.ownValue, totals.ownQuantity, 10);
}

/** Average cost per kg (2 decimals) of own stock, or null without mass. */
export function averageCostPerKg(totals: Pick<ItemTotals, "ownMass" | "ownValue">) {
  if (compareDecimals(totals.ownMass, "0") <= 0) return null;
  return divideDecimal(totals.ownValue, totals.ownMass, 2);
}

/** Value of an outgoing / transferred quantity at the given unit cost (4 decimals). */
export function movementValue(quantity: string, unitCost: string | null): string {
  return unitCost ? divideDecimal(times(quantity, unitCost), "1", 4) : "0";
}

/** Below the minimum stock (own stock only; no minimum → never). */
export function isBelowMinimum(ownQuantity: string, minStock: string | null): boolean {
  return minStock !== null && compareDecimals(ownQuantity, minStock) < 0;
}

// ---------------------------------------------------------------------------
// Display units: length items in metres, everything else in its base unit
// ---------------------------------------------------------------------------

export type DisplayUnit = "m" | "m2" | "kg" | "pcs";

export function displayUnit(unit: BaseUnit): DisplayUnit {
  return unit === "mm" ? "m" : unit;
}

/** Base-unit quantity → display quantity (mm → m with 3 decimals). */
export function toDisplayQuantity(unit: BaseUnit, quantity: string): string {
  return unit === "mm" ? divideDecimal(quantity, "1000", 3) : divideDecimal(quantity, "1", 3);
}

/** Display quantity → base unit (m → mm). */
export function fromDisplayQuantity(unit: BaseUnit, quantity: string): string {
  return unit === "mm" ? multiplyDecimal(quantity, "1000", 3) : quantity;
}

export type StockItemNaming = {
  shape: StockShape;
  diameter: string | null;
  width: string | null;
  thickness: string | null;
  profileLabel: string | null;
};

const comma = (value: string) => value.replace(".", ",");

/** Dimension text: "Ø50", "SW 24", "□40", "40×10", "Ø60×3", "5 mm", "HEA 100". */
export function dimensionLabel(item: StockItemNaming): string {
  const { diameter: d, width: w, thickness: t } = item;
  switch (item.shape) {
    case "round_bar":
      return d ? `Ø${comma(d)}` : "";
    case "hex_bar":
      return d ? `SW ${comma(d)}` : "";
    case "square_bar":
      return w ? `□${comma(w)}` : "";
    case "flat_bar":
      return w && t ? `${comma(w)}×${comma(t)}` : "";
    case "tube":
      return d && t ? `Ø${comma(d)}×${comma(t)}` : "";
    case "sheet":
    case "plate":
      return t ? `${comma(t)} mm` : "";
    case "profile":
      return item.profileLabel ?? "";
    default:
      return "";
  }
}

/** Proposed item name: grade + dimension (the user may change it). */
export function suggestedItemName(item: StockItemNaming, grade: string | null): string {
  return [grade, dimensionLabel(item)].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Pairing product revisions with stock items
// ---------------------------------------------------------------------------

export type RevisionBlank = {
  materialId: string | null;
  geometry: "round" | "tube" | "rectangular" | "hexagon" | "other" | null;
  diameter: string | null;
  width: string | null;
  thickness: string | null;
};

export type PairableItem = StockItemNaming & { id: string; materialId: string | null };

const same = (a: string | null, b: string | null) =>
  a !== null && b !== null && compareDecimals(a, b) === 0;

/**
 * Stock items a revision's raw piece can be cut from: same grade and a shape
 * with the same cross-section. A rectangular blank fits a flat bar (either
 * orientation), a square bar, or a sheet / plate whose thickness is one of
 * the blank's sides.
 */
export function pairingCandidates<T extends PairableItem>(
  blank: RevisionBlank,
  items: readonly T[],
): T[] {
  if (!blank.materialId || !blank.geometry) return [];
  return items.filter((item) => {
    if (item.materialId !== blank.materialId) return false;
    switch (blank.geometry) {
      case "round":
        return item.shape === "round_bar" && same(item.diameter, blank.diameter);
      case "hexagon":
        return item.shape === "hex_bar" && same(item.diameter, blank.diameter);
      case "tube":
        return (
          item.shape === "tube" &&
          same(item.diameter, blank.diameter) &&
          same(item.thickness, blank.thickness)
        );
      case "rectangular":
        switch (item.shape) {
          case "flat_bar":
            return (
              (same(item.width, blank.width) && same(item.thickness, blank.thickness)) ||
              (same(item.width, blank.thickness) && same(item.thickness, blank.width))
            );
          case "square_bar":
            return same(item.width, blank.width) && same(item.width, blank.thickness);
          case "sheet":
          case "plate":
            return same(item.thickness, blank.thickness) || same(item.thickness, blank.width);
          default:
            return false;
        }
      default:
        return false;
    }
  });
}

/** Storage path of a certificate: <organization>/<lot>/<file id>.<ext>. */
export function certificateStoragePath(
  organizationId: string,
  lotId: string,
  fileId: string,
  extension: string,
): string {
  return `${organizationId}/${lotId}/${fileId}.${extension}`;
}

export function isCertificateStoragePath(path: string, organizationId: string, lotId: string) {
  return new RegExp(`^${organizationId}/${lotId}/[0-9a-f-]{36}\\.(pdf|png|jpg|webp)$`).test(path);
}

// ---------------------------------------------------------------------------
// Organization settings (organizations.settings.inventory)
// ---------------------------------------------------------------------------

export type InventorySettings = {
  /** Shortest usable remnant (mm); shorter offcuts are waste. */
  remnantMinLengthMm: string;
  /** VAT rate in percent, used when invoice prices include VAT. */
  vatRate: string;
  /** Default of the "price includes VAT" switch on receipts. */
  pricesIncludeVat: boolean;
};

export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  remnantMinLengthMm: "300",
  vatRate: "17",
  pricesIncludeVat: true,
};

const DECIMAL_TEXT = /^\d+(\.\d+)?$/;

export function inventorySettingsFrom(settings: unknown): InventorySettings {
  const raw =
    settings && typeof settings === "object" && "inventory" in settings
      ? (settings as { inventory: unknown }).inventory
      : null;
  if (!raw || typeof raw !== "object") return DEFAULT_INVENTORY_SETTINGS;
  const value = raw as Record<string, unknown>;
  const decimal = (key: string, fallback: string) => {
    const v = value[key];
    return typeof v === "string" && DECIMAL_TEXT.test(v) ? v : fallback;
  };
  return {
    remnantMinLengthMm: decimal(
      "remnant_min_length_mm",
      DEFAULT_INVENTORY_SETTINGS.remnantMinLengthMm,
    ),
    vatRate: decimal("vat_rate", DEFAULT_INVENTORY_SETTINGS.vatRate),
    pricesIncludeVat:
      typeof value.prices_include_vat === "boolean"
        ? value.prices_include_vat
        : DEFAULT_INVENTORY_SETTINGS.pricesIncludeVat,
  };
}
