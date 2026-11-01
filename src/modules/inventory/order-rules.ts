import {
  addDecimals,
  compareDecimals,
  divideDecimal,
  multiplyDecimal,
  toScaled,
} from "@/lib/decimal";
import type { BaseUnit } from "./rules";

// Material of production orders (D-032). The database is authoritative
// (private.order_material_requirement, order_consumption_proposal,
// post_stock_issue); these mirror it for previews and suggestions.

export type RequirementInput = {
  baseUnit: BaseUnit;
  /** Ordered pieces. */
  quantity: string;
  pieceLength: string | null;
  kerf: string | null;
  /** Bars: the order's bar length and remnant, else the item's standard length. */
  barLength: string | null;
  barRemnant: string | null;
  standardLength: string | null;
  /** Sheets: the item's sheet size and the other side of the piece. */
  standardWidth: string | null;
  pieceWidth: string | null;
  /** Sheets: pieces per sheet set on the order (overrides the estimate). */
  piecesPerSheet: number | null;
};

export type Requirement = {
  /** To reserve, in the base unit (mm or m²). */
  quantity: string;
  /** Material per piece (mm, or m² for sheets). */
  perPiece: string;
  unitLength: string | null;
  unitWidth: string | null;
  piecesPerUnit: number | null;
  /** Sheets: pieces per sheet is the area estimate (not set on the order). */
  estimated: boolean;
  unitsNeeded: number | null;
};

const SCALE = 6;

function wholeDivision(numerator: string, divisor: string): number {
  return Number(toScaled(numerator, SCALE) / toScaled(divisor, SCALE));
}

function ceilDivision(quantity: string, perUnit: number): number {
  const whole = BigInt(wholeDivision(quantity, "1"));
  const per = BigInt(perUnit);
  const rest = compareDecimals(quantity, String(whole)) > 0 ? 1n : 0n;
  return Number((whole + rest + per - 1n) / per);
}

/**
 * Bars: quantity × (cut length + kerf); pieces per bar = ⌊(bar − remnant) /
 * (cut length + kerf)⌋. Sheets: pieces per sheet = order's value or ⌊sheet
 * area / piece area⌋ (piece area with kerf on both sides); the reservation is
 * sheets needed × sheet area, or quantity × piece area without a sheet size.
 */
export function orderRequirement(input: RequirementInput): Requirement | null {
  if (!input.pieceLength) return null;
  const kerf = input.kerf ?? "0";

  if (input.baseUnit === "mm") {
    const perPiece = addDecimals([input.pieceLength, kerf], SCALE);
    const unitLength = input.barLength ?? input.standardLength;
    let piecesPerUnit: number | null = null;
    let unitsNeeded: number | null = null;
    if (unitLength) {
      const usable = addDecimals([unitLength, `-${input.barRemnant ?? "0"}`], SCALE);
      const perBar = wholeDivision(usable, perPiece);
      if (perBar > 0) {
        piecesPerUnit = perBar;
        unitsNeeded = ceilDivision(input.quantity, perBar);
      }
    }
    return {
      quantity: multiplyDecimal(input.quantity, perPiece, SCALE),
      perPiece,
      unitLength,
      unitWidth: null,
      piecesPerUnit,
      estimated: false,
      unitsNeeded,
    };
  }

  if (input.baseUnit === "m2") {
    if (!input.pieceWidth) return null;
    const perPiece = divideDecimal(
      multiplyDecimal(
        addDecimals([input.pieceLength, kerf], SCALE),
        addDecimals([input.pieceWidth, kerf], SCALE),
        SCALE,
      ),
      "1000000",
      SCALE,
    );
    let quantity: string | null = null;
    let piecesPerUnit: number | null = null;
    let unitsNeeded: number | null = null;
    const { standardLength: length, standardWidth: width } = input;
    if (length && width) {
      const area = divideDecimal(multiplyDecimal(length, width, SCALE), "1000000", SCALE);
      const perSheet = input.piecesPerSheet ?? wholeDivision(area, perPiece);
      if (perSheet > 0) {
        piecesPerUnit = perSheet;
        unitsNeeded = ceilDivision(input.quantity, perSheet);
        quantity = multiplyDecimal(String(unitsNeeded), area, SCALE);
      }
    }
    return {
      quantity: quantity ?? multiplyDecimal(input.quantity, perPiece, SCALE),
      perPiece,
      unitLength: length,
      unitWidth: width,
      piecesPerUnit,
      estimated: input.piecesPerSheet === null,
      unitsNeeded,
    };
  }
  return null;
}

/** Consumption proposal: (good + scrap of the first operation) × material per piece. */
export function consumptionProposal(good: string, scrap: string, perPiece: string): string {
  return multiplyDecimal(addDecimals([good, scrap], SCALE), perPiece, SCALE);
}

/** Issued − consumed − returned (positive: material unaccounted for). */
export function materialDifference(issued: string, consumed: string, returned: string): string {
  return addDecimals([issued, `-${consumed}`, `-${returned}`], SCALE);
}

/** Pieces still missing for a shortage in the base unit (rounded up). */
export function missingPieces(shortage: string, perPiece: string): number {
  if (compareDecimals(shortage, "0") <= 0) return 0;
  const whole = wholeDivision(shortage, perPiece);
  const exact = compareDecimals(multiplyDecimal(String(whole), perPiece, SCALE), shortage) === 0;
  return exact ? whole : whole + 1;
}

/** Offcut of a bar cut into pieces: length − pieces × (cut length + kerf), or null when nothing is left. */
export function offcutLength(
  barLength: string,
  cutPieces: number,
  perPiece: string,
): string | null {
  const left = addDecimals(
    [barLength, `-${multiplyDecimal(String(cutPieces), perPiece, SCALE)}`],
    1,
  );
  return compareDecimals(left, "0") > 0 ? left : null;
}

/** Pieces that fit into one bar of this length. */
export function piecesFromBar(barLength: string, perPiece: string): number {
  return wholeDivision(barLength, perPiece);
}

export type IssueBucket = {
  lotId: string;
  locationId: string;
  length: string | null;
  width: string | null;
  pieces: number | null;
  quantity: string;
  ownerCustomerId: string | null;
};

export type RankedBucket<T extends IssueBucket> = T & {
  /** A shorter piece than the standard bar / sheet (an earlier offcut). */
  remnant: boolean;
  /** Remnant below the organization's minimum length. */
  short: boolean;
  /** Fits at least one piece. */
  fits: boolean;
};

/**
 * Buckets the order may take from, best first: the order customer's own
 * material, then remnants that fit (smallest first, short ones last), then
 * standard pieces; buckets that fit no piece go to the end. Material of other
 * customers is left out.
 */
export function rankIssueBuckets<T extends IssueBucket>(
  buckets: readonly T[],
  options: {
    customerId: string;
    perPiece: string | null;
    standardLength: string | null;
    minRemnant: string;
  },
): RankedBucket<T>[] {
  const ranked = buckets
    .filter((b) => b.ownerCustomerId === null || b.ownerCustomerId === options.customerId)
    .map((b) => {
      const remnant =
        b.length !== null &&
        options.standardLength !== null &&
        compareDecimals(b.length, options.standardLength) < 0;
      return {
        ...b,
        remnant,
        short: remnant && b.length !== null && compareDecimals(b.length, options.minRemnant) < 0,
        fits:
          options.perPiece === null ||
          b.length === null ||
          compareDecimals(b.length, options.perPiece) >= 0,
      };
    });
  const rank = (b: RankedBucket<T>) =>
    (b.fits ? 0 : 8) + (b.ownerCustomerId ? 0 : 4) + (b.remnant ? (b.short ? 2 : 0) : 1);
  return ranked.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.remnant && b.remnant && a.length && b.length ? compareDecimals(a.length, b.length) : 0),
  );
}
