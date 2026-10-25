import { describe, expect, it } from "vitest";
import { matchesFloorSearch, pickMyOperation } from "./floor-rules";

const op = (id: string, values: Partial<{ status: string; mine: boolean; arrived: boolean }>) => ({
  id,
  status: "waiting",
  mine: true,
  arrived: false,
  ...values,
});

describe("order QR code target", () => {
  it("opens the caller's operation that has arrived", () => {
    expect(
      pickMyOperation([
        op("rz", { mine: false, arrived: true }),
        op("gl", { arrived: true }),
        op("to", {}),
      ]),
    ).toBe("gl");
  });

  it("opens the only own operation even if it has not arrived yet", () => {
    expect(pickMyOperation([op("rz", { mine: false, arrived: true }), op("gl", {})])).toBe("gl");
  });

  it("shows the order when nothing or several operations fit", () => {
    expect(pickMyOperation([op("rz", { mine: false, arrived: true })])).toBeNull();
    expect(pickMyOperation([op("gl", {}), op("to", {})])).toBeNull();
    expect(pickMyOperation([op("gl", { status: "done", arrived: true })])).toBeNull();
  });
});

describe("floor search", () => {
  const item = {
    orderNumber: "RN13-0526-358",
    partNumber: "DM-4711-02",
    productName: "Osovina Ø40",
  };

  it("finds by order number, part number or name, ignoring case and diacritics", () => {
    expect(matchesFloorSearch(item, "0526-358")).toBe(true);
    expect(matchesFloorSearch(item, "4711")).toBe(true);
    expect(matchesFloorSearch(item, "osovina")).toBe(true);
    expect(matchesFloorSearch(item, "osovina 4711")).toBe(true);
    expect(matchesFloorSearch(item, "čep")).toBe(false);
  });
});
