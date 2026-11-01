import { describe, expect, it } from "vitest";
import {
  averageCostPerKg,
  averageUnitCost,
  balancesFromMovements,
  baseUnitsForShape,
  certificateStoragePath,
  dimensionLabel,
  fromDisplayQuantity,
  hasNegativeBucket,
  inventorySettingsFrom,
  isBelowMinimum,
  isCertificateStoragePath,
  itemTotals,
  kgPerMetre,
  kgPerUnit,
  lineMass,
  lineQuantity,
  movementValue,
  pairingCandidates,
  receiptLineValue,
  suggestedItemName,
  toDisplayQuantity,
  type LedgerMovement,
  type StockItemGeometry,
} from "./rules";

const STEEL = "7.85";
const roundBar50: StockItemGeometry = {
  shape: "round_bar",
  baseUnit: "mm",
  diameter: "50",
  width: null,
  thickness: null,
  massPerM: null,
};
const sheet5: StockItemGeometry = {
  shape: "sheet",
  baseUnit: "m2",
  diameter: null,
  width: null,
  thickness: "5",
  massPerM: null,
};

describe("baseUnitsForShape", () => {
  it("keeps bars in mm, sheets in m² and other items in kg or pieces", () => {
    expect(baseUnitsForShape("round_bar")).toEqual(["mm"]);
    expect(baseUnitsForShape("profile")).toEqual(["mm"]);
    expect(baseUnitsForShape("plate")).toEqual(["m2"]);
    expect(baseUnitsForShape("other")).toEqual(["kg", "pcs"]);
  });
});

describe("kgPerUnit", () => {
  it("round bar Ø50 steel weighs 15.4134 kg/m", () => {
    expect(kgPerMetre(roundBar50, STEEL)).toBe("15.4134");
  });

  it("uses the same cross-sections as the product blank", () => {
    const hex = { ...roundBar50, shape: "hex_bar" as const, diameter: "24" };
    // √3/2 · 24² · 7.85 / 1000 = 3.9158 kg/m
    expect(kgPerMetre(hex, STEEL)).toBe("3.9158");
    const flat = {
      ...roundBar50,
      shape: "flat_bar" as const,
      diameter: null,
      width: "40",
      thickness: "10",
    };
    expect(kgPerMetre(flat, STEEL)).toBe("3.14");
    const tube = { ...roundBar50, shape: "tube" as const, diameter: "60", thickness: "3" };
    // π · 3 · 57 · 7.85 / 1000 = 4.2171 kg/m
    expect(kgPerMetre(tube, STEEL)).toBe("4.2171");
  });

  it("prefers kg/m from the supplier table", () => {
    expect(kgPerMetre({ ...roundBar50, massPerM: "15.6" }, STEEL)).toBe("15.6");
    const profile = { ...roundBar50, shape: "profile" as const, diameter: null, massPerM: "16.7" };
    expect(kgPerMetre(profile, null)).toBe("16.7");
  });

  it("sheets: thickness × density per m²", () => {
    expect(kgPerUnit(sheet5, STEEL)).toBe("39.25");
  });

  it("kg items are 1, pieces and unknown density have no mass", () => {
    const other = { ...roundBar50, shape: "other" as const, diameter: null };
    expect(kgPerUnit({ ...other, baseUnit: "kg" }, null)).toBe("1");
    expect(kgPerUnit({ ...other, baseUnit: "pcs" }, STEEL)).toBeNull();
    expect(kgPerUnit(roundBar50, null)).toBeNull();
  });
});

describe("lineQuantity and lineMass", () => {
  it("bars: pieces × length in mm", () => {
    const quantity = lineQuantity("mm", { pieces: 3, length: "3000", width: null, quantity: null });
    expect(quantity).toBe("9000");
    expect(lineMass("9000", kgPerUnit(roundBar50, STEEL))).toBe("138.721");
  });

  it("sheets: pieces × length × width in m²", () => {
    const quantity = lineQuantity("m2", {
      pieces: 2,
      length: "2000",
      width: "1000",
      quantity: null,
    });
    expect(quantity).toBe("4");
    expect(lineMass("4", kgPerUnit(sheet5, STEEL))).toBe("157");
    expect(lineQuantity("m2", { pieces: 1, length: "1240", width: "800", quantity: null })).toBe(
      "0.992",
    );
  });

  it("rejects lines that do not fit the unit", () => {
    expect(lineQuantity("mm", { pieces: 1, length: null, width: null, quantity: null })).toBeNull();
    expect(lineQuantity("mm", { pieces: 1, length: "10", width: "5", quantity: null })).toBeNull();
    expect(lineQuantity("m2", { pieces: 1, length: "10", width: null, quantity: null })).toBeNull();
    expect(lineQuantity("kg", { pieces: 2, length: null, width: null, quantity: "5" })).toBeNull();
    expect(
      lineQuantity("pcs", { pieces: null, length: null, width: null, quantity: "1.5" }),
    ).toBeNull();
    expect(lineQuantity("kg", { pieces: null, length: null, width: null, quantity: "12.5" })).toBe(
      "12.5",
    );
  });
});

describe("receiptLineValue", () => {
  const base = {
    unit: "mm" as const,
    quantity: "9000",
    pieces: 3,
    mass: "138.721",
    unitPrice: "2.5",
    priceUnit: "kg" as const,
    invoiceKg: null,
    includesVat: false,
    vatRate: "17",
  };

  it("price per kg uses the theoretical mass, or the invoice kg when given", () => {
    expect(receiptLineValue(base)).toBe("346.8025");
    expect(receiptLineValue({ ...base, invoiceKg: "140" })).toBe("350");
  });

  it("removes VAT when the invoice price includes it", () => {
    // 346.8025 × 100 / 117
    expect(receiptLineValue({ ...base, includesVat: true })).toBe("296.4124");
  });

  it("price per metre, m² or piece", () => {
    expect(receiptLineValue({ ...base, priceUnit: "m", unitPrice: "20" })).toBe("180");
    expect(receiptLineValue({ ...base, priceUnit: "piece", unitPrice: "50" })).toBe("150");
    expect(
      receiptLineValue({
        ...base,
        unit: "m2",
        quantity: "4",
        pieces: 2,
        priceUnit: "m2",
        unitPrice: "80",
      }),
    ).toBe("320");
  });

  it("has no basis for a price unit that does not fit", () => {
    expect(receiptLineValue({ ...base, priceUnit: "m2" })).toBeNull();
    expect(
      receiptLineValue({ ...base, unit: "pcs", pieces: null, quantity: "10", mass: null }),
    ).toBeNull();
  });
});

function movement(partial: Partial<LedgerMovement>): LedgerMovement {
  return {
    itemId: "item",
    lotId: "lot-1",
    locationId: "m1",
    length: "6000",
    width: null,
    pieces: 1,
    quantity: "6000",
    mass: "92.4806",
    value: "0",
    customerOwned: false,
    ...partial,
  };
}

describe("ledger", () => {
  it("balance is the sum of movements per lot, location and piece size", () => {
    const balances = balancesFromMovements([
      movement({ pieces: 4, quantity: "24000" }),
      movement({ pieces: -1, quantity: "-6000" }),
      // A remnant of the cut bar is its own bucket.
      movement({ length: "1240", pieces: 1, quantity: "1240" }),
      movement({ locationId: "m2", pieces: 1, quantity: "6000" }),
      movement({ locationId: "m2", pieces: -1, quantity: "-6000" }),
    ]);
    expect(balances).toEqual([
      expect.objectContaining({ locationId: "m1", length: "6000", pieces: 3, quantity: "18000" }),
      expect.objectContaining({ locationId: "m1", length: "1240", pieces: 1, quantity: "1240" }),
    ]);
    expect(hasNegativeBucket(balances)).toBe(false);
  });

  it("detects a bucket below zero", () => {
    const balances = balancesFromMovements([
      movement({ pieces: 1, quantity: "6000" }),
      movement({ pieces: -2, quantity: "-12000" }),
    ]);
    expect(hasNegativeBucket(balances)).toBe(true);
  });

  it("moving weighted average: receipts move it, issues at the average keep it", () => {
    const ledger = [
      movement({ length: "3000", pieces: 3, quantity: "9000", mass: "138.721", value: "270" }),
      movement({ lotId: "lot-2", pieces: 1, quantity: "6000", mass: "92.4806", value: "240" }),
    ];
    const before = itemTotals(ledger);
    const cost = averageUnitCost(before);
    expect(cost).toBe("0.034");

    const out = movementValue("3000", cost);
    expect(out).toBe("102");
    const after = itemTotals([
      ...ledger,
      movement({
        length: "3000",
        pieces: -1,
        quantity: "-3000",
        mass: "-46.2403",
        value: `-${out}`,
      }),
    ]);
    expect(after.ownQuantity).toBe("12000");
    expect(after.ownValue).toBe("408");
    expect(averageUnitCost(after)).toBe("0.034");
  });

  it("customer material has no value and stays out of the average", () => {
    const totals = itemTotals([
      movement({ quantity: "6000", value: "240", mass: "92.4806" }),
      movement({ lotId: "customer-lot", quantity: "6000", value: "0", customerOwned: true }),
    ]);
    expect(totals.quantity).toBe("12000");
    expect(totals.ownQuantity).toBe("6000");
    expect(averageUnitCost(totals)).toBe("0.04");
    expect(averageCostPerKg(totals)).toBe("2.6");
  });

  it("no own stock has no average", () => {
    expect(averageUnitCost({ ownQuantity: "0", ownValue: "0" })).toBeNull();
    expect(movementValue("3000", null)).toBe("0");
  });
});

describe("minimum and display units", () => {
  it("below minimum only when a minimum is set", () => {
    expect(isBelowMinimum("5000", "6000")).toBe(true);
    expect(isBelowMinimum("6000", "6000")).toBe(false);
    expect(isBelowMinimum("0", null)).toBe(false);
  });

  it("length items are shown in metres", () => {
    expect(toDisplayQuantity("mm", "18000")).toBe("18");
    expect(toDisplayQuantity("mm", "1240")).toBe("1.24");
    expect(fromDisplayQuantity("mm", "12.5")).toBe("12500");
    expect(toDisplayQuantity("m2", "0.992")).toBe("0.992");
    expect(fromDisplayQuantity("kg", "40")).toBe("40");
  });
});

describe("naming", () => {
  it("builds dimension labels and proposed names", () => {
    const naming = { diameter: null, width: null, thickness: null, profileLabel: null };
    expect(dimensionLabel({ ...naming, shape: "round_bar", diameter: "50" })).toBe("Ø50");
    expect(dimensionLabel({ ...naming, shape: "hex_bar", diameter: "24" })).toBe("SW 24");
    expect(dimensionLabel({ ...naming, shape: "square_bar", width: "40" })).toBe("□40");
    expect(dimensionLabel({ ...naming, shape: "flat_bar", width: "40", thickness: "10" })).toBe(
      "40×10",
    );
    expect(dimensionLabel({ ...naming, shape: "tube", diameter: "60.3", thickness: "3" })).toBe(
      "Ø60,3×3",
    );
    expect(dimensionLabel({ ...naming, shape: "plate", thickness: "20" })).toBe("20 mm");
    expect(dimensionLabel({ ...naming, shape: "profile", profileLabel: "HEA 100" })).toBe(
      "HEA 100",
    );
    expect(suggestedItemName({ ...naming, shape: "round_bar", diameter: "50" }, "C45")).toBe(
      "C45 Ø50",
    );
  });
});

describe("pairingCandidates", () => {
  const naming = { diameter: null, width: null, thickness: null, profileLabel: null };
  const items = [
    { ...naming, id: "r50", materialId: "c45", shape: "round_bar" as const, diameter: "50" },
    { ...naming, id: "r50-s235", materialId: "s235", shape: "round_bar" as const, diameter: "50" },
    { ...naming, id: "hex24", materialId: "c45", shape: "hex_bar" as const, diameter: "24" },
    {
      ...naming,
      id: "fl40x10",
      materialId: "s235",
      shape: "flat_bar" as const,
      width: "40",
      thickness: "10",
    },
    { ...naming, id: "sq40", materialId: "s235", shape: "square_bar" as const, width: "40" },
    { ...naming, id: "pl10", materialId: "s235", shape: "plate" as const, thickness: "10" },
    {
      ...naming,
      id: "t60",
      materialId: "s235",
      shape: "tube" as const,
      diameter: "60",
      thickness: "3",
    },
  ];
  const blank = {
    materialId: "c45",
    geometry: "round" as const,
    diameter: "50.0",
    width: null,
    thickness: null,
  };
  const ids = (b: typeof blank | Parameters<typeof pairingCandidates>[0]) =>
    pairingCandidates(b, items).map((item) => item.id);

  it("matches grade and cross-section", () => {
    expect(ids(blank)).toEqual(["r50"]);
    expect(ids({ ...blank, geometry: "hexagon", diameter: "24" })).toEqual(["hex24"]);
    expect(
      ids({ ...blank, materialId: "s235", geometry: "tube", diameter: "60", thickness: "3" }),
    ).toEqual(["t60"]);
  });

  it("a rectangular blank fits a flat bar either way round or a plate of that thickness", () => {
    expect(
      ids({
        materialId: "s235",
        geometry: "rectangular",
        diameter: null,
        width: "10",
        thickness: "40",
      }),
    ).toEqual(["fl40x10", "pl10"]);
    expect(
      ids({
        materialId: "s235",
        geometry: "rectangular",
        diameter: null,
        width: "40",
        thickness: "10",
      }),
    ).toEqual(["fl40x10", "pl10"]);
    expect(
      ids({
        materialId: "s235",
        geometry: "rectangular",
        diameter: null,
        width: "40",
        thickness: "40",
      }),
    ).toEqual(["sq40"]);
  });

  it("no grade or no shape has no candidates", () => {
    expect(ids({ ...blank, materialId: null })).toEqual([]);
    expect(ids({ ...blank, geometry: "other" })).toEqual([]);
    expect(ids({ ...blank, geometry: null })).toEqual([]);
  });
});

describe("certificates and settings", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const LOT = "22222222-2222-4222-8222-222222222222";
  const FILE = "33333333-3333-4333-8333-333333333333";

  it("certificate paths stay in the lot folder", () => {
    const path = certificateStoragePath(ORG, LOT, FILE, "pdf");
    expect(path).toBe(`${ORG}/${LOT}/${FILE}.pdf`);
    expect(isCertificateStoragePath(path, ORG, LOT)).toBe(true);
    expect(isCertificateStoragePath(`${ORG}/${FILE}/${FILE}.pdf`, ORG, LOT)).toBe(false);
    expect(isCertificateStoragePath(`${ORG}/${LOT}/../x.pdf`, ORG, LOT)).toBe(false);
  });

  it("settings fall back to defaults", () => {
    expect(inventorySettingsFrom(null)).toEqual({
      remnantMinLengthMm: "300",
      vatRate: "17",
      pricesIncludeVat: true,
    });
    expect(
      inventorySettingsFrom({
        inventory: { remnant_min_length_mm: "500", vat_rate: "x", prices_include_vat: false },
      }),
    ).toEqual({ remnantMinLengthMm: "500", vatRate: "17", pricesIncludeVat: false });
  });
});
