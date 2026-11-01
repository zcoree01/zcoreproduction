import { describe, expect, it } from "vitest";
import {
  adjustmentSchema,
  decisionSchema,
  inventorySettingsSchema,
  locationSchema,
  receiptSchema,
  stockItemSchema,
  transferSchema,
  type StockItemFormValues,
} from "./schemas";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const item: StockItemFormValues = {
  code: "C45-50",
  name: "C45 Ø50",
  materialId: ID,
  shape: "round_bar",
  diameter: "50",
  width: "",
  thickness: "",
  profileLabel: "",
  baseUnit: "mm",
  standardLength: "3000",
  standardWidth: "",
  massPerM: "",
  supplier: "",
  minStock: "12,5",
  defaultLocationId: "",
  notes: "",
};

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join(".")) ?? [];

describe("stockItemSchema", () => {
  it("accepts a round bar and normalises decimals", () => {
    const parsed = stockItemSchema.parse(item);
    expect(parsed.diameter).toBe("50");
    expect(parsed.minStock).toBe("12.5");
    expect(parsed.width).toBeNull();
  });

  it("requires exactly the dimensions of the shape", () => {
    expect(issuePaths(stockItemSchema.safeParse({ ...item, diameter: "" }))).toEqual(["diameter"]);
    expect(issuePaths(stockItemSchema.safeParse({ ...item, width: "20" }))).toEqual(["width"]);
    expect(
      issuePaths(
        stockItemSchema.safeParse({ ...item, shape: "flat_bar", diameter: "", width: "40" }),
      ),
    ).toEqual(["thickness"]);
  });

  it("tube wall must be thinner than half the diameter", () => {
    expect(
      issuePaths(
        stockItemSchema.safeParse({ ...item, shape: "tube", diameter: "20", thickness: "10" }),
      ),
    ).toEqual(["thickness"]);
  });

  it("unit follows the shape", () => {
    expect(issuePaths(stockItemSchema.safeParse({ ...item, baseUnit: "kg" }))).toContain(
      "baseUnit",
    );
    const sheet = {
      ...item,
      shape: "sheet" as const,
      diameter: "",
      thickness: "5",
      baseUnit: "m2" as const,
    };
    expect(stockItemSchema.safeParse({ ...sheet, standardWidth: "1000" }).success).toBe(true);
    expect(issuePaths(stockItemSchema.safeParse({ ...sheet, massPerM: "3" }))).toEqual([
      "massPerM",
    ]);
  });

  it("profiles need a designation and kg per metre", () => {
    const profile = { ...item, shape: "profile" as const, diameter: "" };
    expect(issuePaths(stockItemSchema.safeParse(profile))).toEqual(["profileLabel", "massPerM"]);
    expect(
      stockItemSchema.safeParse({ ...profile, profileLabel: "HEA 100", massPerM: "16,7" }).success,
    ).toBe(true);
  });
});

describe("locationSchema", () => {
  it("shelves need a warehouse, machine places a machine", () => {
    const base = {
      kind: "shelf" as const,
      parentId: ID,
      machineId: "",
      code: "P1",
      name: "Polica 1",
    };
    expect(locationSchema.safeParse(base).success).toBe(true);
    expect(issuePaths(locationSchema.safeParse({ ...base, parentId: "" }))).toEqual(["parentId"]);
    expect(
      issuePaths(
        locationSchema.safeParse({ ...base, kind: "machine", parentId: "", machineId: "" }),
      ),
    ).toEqual(["machineId"]);
    expect(issuePaths(locationSchema.safeParse({ ...base, code: "P 1" }))).toEqual(["code"]);
  });
});

describe("receiptSchema", () => {
  const line = {
    itemId: ID,
    locationId: ID2,
    pieces: "3",
    length: "3000",
    width: "",
    quantity: "",
    heatNumber: "",
    ownerCustomerId: "",
    unitPrice: "2,45",
    priceUnit: "kg",
    invoiceKg: "",
  };
  const receipt = {
    idempotencyKey: ID,
    documentDate: "2026-10-28",
    supplier: "Čelik d.o.o.",
    deliveryNote: "OTP-123",
    notes: "",
    pricesIncludeVat: true,
    lines: [line],
  };

  it("parses pieces and prices", () => {
    const parsed = receiptSchema.parse(receipt);
    expect(parsed.lines[0]?.pieces).toBe(3);
    expect(parsed.lines[0]?.unitPrice).toBe("2.45");
  });

  it("own material needs a price, customer material does not", () => {
    const noPrice = { ...line, unitPrice: "", priceUnit: "" };
    expect(issuePaths(receiptSchema.safeParse({ ...receipt, lines: [noPrice] }))).toEqual([
      "lines.0.unitPrice",
    ]);
    expect(
      receiptSchema.safeParse({ ...receipt, lines: [{ ...noPrice, ownerCustomerId: ID }] }).success,
    ).toBe(true);
  });

  it("rejects zero or fractional pieces and empty receipts", () => {
    expect(receiptSchema.safeParse({ ...receipt, lines: [{ ...line, pieces: "0" }] }).success).toBe(
      false,
    );
    expect(
      receiptSchema.safeParse({ ...receipt, lines: [{ ...line, pieces: "1.5" }] }).success,
    ).toBe(false);
    expect(receiptSchema.safeParse({ ...receipt, lines: [] }).success).toBe(false);
  });
});

describe("transferSchema", () => {
  const transfer = {
    idempotencyKey: ID,
    itemId: ID,
    lotId: ID,
    fromLocationId: ID,
    toLocationId: ID2,
    length: "3000",
    width: "",
    pieces: "2",
    quantity: "",
    notes: "",
  };

  it("moves to another location", () => {
    expect(transferSchema.safeParse(transfer).success).toBe(true);
    expect(issuePaths(transferSchema.safeParse({ ...transfer, toLocationId: ID }))).toEqual([
      "toLocationId",
    ]);
  });

  it("needs pieces or a quantity, not both", () => {
    expect(issuePaths(transferSchema.safeParse({ ...transfer, quantity: "5" }))).toEqual([
      "pieces",
    ]);
  });
});

describe("adjustmentSchema", () => {
  const adjustment = {
    idempotencyKey: ID,
    reason: "Pronađeno pri popisu",
    post: false,
    itemId: ID,
    lotId: ID2,
    locationId: ID,
    length: "3000",
    width: "",
    pieces: "-1",
    quantity: "",
  };

  it("accepts signed pieces and requires a reason", () => {
    expect(adjustmentSchema.parse(adjustment).pieces).toBe(-1);
    expect(issuePaths(adjustmentSchema.safeParse({ ...adjustment, reason: "  " }))).toEqual([
      "reason",
    ]);
  });

  it("a missing piece needs its lot; a found one may come without", () => {
    expect(issuePaths(adjustmentSchema.safeParse({ ...adjustment, lotId: "" }))).toEqual(["lotId"]);
    expect(adjustmentSchema.safeParse({ ...adjustment, lotId: "", pieces: "1" }).success).toBe(
      true,
    );
  });

  it("kg items use a signed quantity", () => {
    const kg = { ...adjustment, length: "", pieces: "", quantity: "-2,5" };
    expect(adjustmentSchema.parse(kg).quantity).toBe("-2.5");
    expect(issuePaths(adjustmentSchema.safeParse({ ...kg, quantity: "0" }))).toEqual(["pieces"]);
  });
});

describe("decisionSchema and settings", () => {
  it("rejecting needs a note", () => {
    expect(decisionSchema.safeParse({ documentId: ID, approve: true, note: "" }).success).toBe(
      true,
    );
    expect(
      issuePaths(decisionSchema.safeParse({ documentId: ID, approve: false, note: "" })),
    ).toEqual(["note"]);
  });

  it("settings need a remnant length and a VAT rate", () => {
    const settings = { remnantMinLengthMm: "300", vatRate: "17", pricesIncludeVat: true };
    expect(inventorySettingsSchema.safeParse(settings).success).toBe(true);
    expect(inventorySettingsSchema.safeParse({ ...settings, remnantMinLengthMm: "" }).success).toBe(
      false,
    );
    expect(inventorySettingsSchema.safeParse({ ...settings, vatRate: "101" }).success).toBe(false);
  });
});
