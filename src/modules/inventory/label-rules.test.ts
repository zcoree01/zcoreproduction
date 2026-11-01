import { describe, expect, it } from "vitest";
import { lotLabelPath, parseLabelSize, parseScan, scanTargetPath } from "./label-rules";

const LOT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

describe("parseScan", () => {
  it("reads lot, location and order links from any host", () => {
    expect(parseScan(`https://firma.zcore.ba${lotLabelPath(LOT)}`)).toEqual({
      kind: "lot",
      lotId: LOT,
    });
    expect(parseScan(`http://192.168.1.7:3000/floor/warehouse/location/${LOT}?org=demo`)).toEqual({
      kind: "location",
      locationId: LOT,
    });
    expect(parseScan(`https://firma.zcore.ba/floor/orders/${ORDER.toUpperCase()}`)).toEqual({
      kind: "order",
      orderId: ORDER,
    });
  });

  it("ignores other codes", () => {
    expect(parseScan("zcore-kiosk:abcdef")).toBeNull();
    expect(parseScan(`/floor/warehouse/lot/${LOT}x`)).toBeNull();
    expect(parseScan("")).toBeNull();
  });

  it("opens the warehouse screen of a target", () => {
    expect(scanTargetPath({ kind: "order", orderId: ORDER })).toBe(
      `/floor/warehouse/order/${ORDER}`,
    );
  });
});

describe("parseLabelSize", () => {
  it("defaults to 70 × 40 mm", () => {
    expect(parseLabelSize("50x30")).toBe("50x30");
    expect(parseLabelSize("xxl")).toBe("70x40");
    expect(parseLabelSize(undefined)).toBe("70x40");
  });
});
