import { describe, expect, it } from "vitest";
import {
  consumptionProposal,
  materialDifference,
  missingPieces,
  offcutLength,
  orderRequirement,
  piecesFromBar,
  rankIssueBuckets,
  type IssueBucket,
  type RequirementInput,
} from "./order-rules";

const bar: RequirementInput = {
  baseUnit: "mm",
  quantity: "50",
  pieceLength: "100",
  kerf: "2",
  barLength: null,
  barRemnant: null,
  standardLength: "3000",
  standardWidth: null,
  pieceWidth: null,
  piecesPerSheet: null,
};

describe("orderRequirement", () => {
  it("bars: quantity × (cut length + kerf), pieces per bar and bars needed", () => {
    expect(orderRequirement(bar)).toEqual({
      quantity: "5100",
      perPiece: "102",
      unitLength: "3000",
      unitWidth: null,
      piecesPerUnit: 29,
      estimated: false,
      unitsNeeded: 2,
    });
  });

  it("uses the order's bar length and remnant", () => {
    // (6000 − 200) / 102 = 56 pieces per bar → 50 pieces in one bar.
    const result = orderRequirement({ ...bar, barLength: "6000", barRemnant: "200" });
    expect(result).toMatchObject({ piecesPerUnit: 56, unitsNeeded: 1, quantity: "5100" });
  });

  it("counts a partly used bar as a whole one", () => {
    expect(orderRequirement({ ...bar, quantity: "30" })?.unitsNeeded).toBe(2);
    expect(orderRequirement({ ...bar, quantity: "29" })?.unitsNeeded).toBe(1);
  });

  it("without a bar length there is no bar count, only the length", () => {
    expect(orderRequirement({ ...bar, standardLength: null })).toMatchObject({
      quantity: "5100",
      piecesPerUnit: null,
      unitsNeeded: null,
    });
  });

  it("sheets: pieces per sheet by area, overridable, reserving whole sheets", () => {
    const sheet: RequirementInput = {
      ...bar,
      baseUnit: "m2",
      quantity: "100",
      pieceLength: "200",
      pieceWidth: "100",
      kerf: "3",
      standardLength: "2000",
      standardWidth: "1000",
    };
    // 2 m² / (0.203 × 0.103 m²) = 95 pieces → 2 sheets = 4 m².
    expect(orderRequirement(sheet)).toMatchObject({
      perPiece: "0.020909",
      piecesPerUnit: 95,
      estimated: true,
      unitsNeeded: 2,
      quantity: "4",
    });
    expect(orderRequirement({ ...sheet, piecesPerSheet: 80 })).toMatchObject({
      piecesPerUnit: 80,
      estimated: false,
      unitsNeeded: 2,
    });
    expect(orderRequirement({ ...sheet, piecesPerSheet: 120 })).toMatchObject({
      unitsNeeded: 1,
      quantity: "2",
    });
  });

  it("needs a cut length (and for sheets the other side)", () => {
    expect(orderRequirement({ ...bar, pieceLength: null })).toBeNull();
    expect(orderRequirement({ ...bar, baseUnit: "m2" })).toBeNull();
    expect(orderRequirement({ ...bar, baseUnit: "kg" })).toBeNull();
  });
});

describe("consumption", () => {
  it("scrap consumes material too", () => {
    expect(consumptionProposal("10", "2", "102")).toBe("1224");
  });

  it("difference is issued − consumed − returned", () => {
    expect(materialDifference("2958", "1250", "500")).toBe("1208");
  });

  it("missing pieces round up", () => {
    expect(missingPieces("1122", "102")).toBe(11);
    expect(missingPieces("1123", "102")).toBe(12);
    expect(missingPieces("0", "102")).toBe(0);
  });
});

describe("cutting a bar", () => {
  it("offcut and pieces per bar", () => {
    expect(piecesFromBar("3000", "102")).toBe(29);
    expect(offcutLength("3000", 29, "102")).toBe("42");
    expect(offcutLength("1224", 12, "102")).toBeNull();
  });
});

describe("rankIssueBuckets", () => {
  const bucket = (partial: Partial<IssueBucket>): IssueBucket => ({
    lotId: "lot",
    locationId: "m1",
    length: "3000",
    width: null,
    pieces: 1,
    quantity: "3000",
    ownerCustomerId: null,
    ...partial,
  });
  const order = (buckets: IssueBucket[]) =>
    rankIssueBuckets(buckets, {
      customerId: "c1",
      perPiece: "102",
      standardLength: "3000",
      minRemnant: "300",
    }).map((b) => b.lotId);

  it("offers fitting remnants first, smallest first, short remnants after full bars", () => {
    expect(
      order([
        bucket({ lotId: "full" }),
        bucket({ lotId: "remnant-1240", length: "1240" }),
        bucket({ lotId: "remnant-500", length: "500" }),
        bucket({ lotId: "short-150", length: "150" }),
        bucket({ lotId: "too-short-42", length: "42" }),
      ]),
    ).toEqual(["remnant-500", "remnant-1240", "full", "short-150", "too-short-42"]);
  });

  it("the order customer's material comes first, other customers' never", () => {
    expect(
      order([
        bucket({ lotId: "own" }),
        bucket({ lotId: "customer", ownerCustomerId: "c1" }),
        bucket({ lotId: "other", ownerCustomerId: "c2" }),
      ]),
    ).toEqual(["customer", "own"]);
  });

  it("marks remnants and short ones", () => {
    const [ranked] = rankIssueBuckets([bucket({ length: "150" })], {
      customerId: "c1",
      perPiece: "102",
      standardLength: "3000",
      minRemnant: "300",
    });
    expect(ranked).toMatchObject({ remnant: true, short: true, fits: true });
  });
});
