import { describe, expect, it } from "vitest";
import {
  columnValue,
  DEFAULT_LAYOUT,
  deliveryNumberSettingsFrom,
  formatDeliveryNumber,
  isLogoStoragePath,
  isValidDeliveryNumberTemplate,
  layoutFrom,
  logoStoragePath,
  receivable,
} from "./rules";

describe("delivery note numbers", () => {
  it("formats customer, month, year and the yearly sequence: 03-0326-122", () => {
    expect(
      formatDeliveryNumber({
        template: "{KUPAC2}-{MJESEC}{GODINA}-{BROJ}",
        digits: 1,
        customerNumber: 3,
        date: "2026-03-15",
        sequence: 122,
      }),
    ).toBe("03-0326-122");
    expect(
      formatDeliveryNumber({
        template: "OT-{GODINA4}/{BROJ}",
        digits: 4,
        customerNumber: 117,
        date: "2026-11-02",
        sequence: 7,
      }),
    ).toBe("OT-2026/0007");
    expect(
      formatDeliveryNumber({
        template: "{KUPAC2}-{BROJ}",
        digits: 1,
        customerNumber: 117,
        date: "2026-11-02",
        sequence: 1,
      }),
    ).toBe("117-1");
  });

  it("validates templates like the database", () => {
    expect(isValidDeliveryNumberTemplate("{KUPAC2}-{MJESEC}{GODINA}-{BROJ}")).toBe(true);
    expect(isValidDeliveryNumberTemplate("OT-{GODINA4}")).toBe(false);
    expect(isValidDeliveryNumberTemplate("{BROJ}#")).toBe(false);
    expect(isValidDeliveryNumberTemplate("{NEPOZNATO}-{BROJ}")).toBe(false);
  });

  it("reads settings with defaults", () => {
    expect(deliveryNumberSettingsFrom({})).toEqual({
      template: "{KUPAC2}-{MJESEC}{GODINA}-{BROJ}",
      digits: 1,
    });
    expect(
      deliveryNumberSettingsFrom({
        delivery_note_number_template: "OT-{BROJ}",
        delivery_note_number_digits: 3,
      }),
    ).toEqual({ template: "OT-{BROJ}", digits: 3 });
  });
});

describe("receivable", () => {
  it("good pieces not received yet, never below zero", () => {
    expect(receivable("10", "6")).toBe("4");
    expect(receivable("10", "10")).toBe("0");
    expect(receivable("8", "10")).toBe("0");
  });
});

describe("templates", () => {
  it("falls back to the default layout", () => {
    expect(layoutFrom({ title: "" })).toEqual(DEFAULT_LAYOUT);
    expect(layoutFrom({ ...DEFAULT_LAYOUT, title: "Lieferschein" }).title).toBe("Lieferschein");
    expect(
      layoutFrom({
        ...DEFAULT_LAYOUT,
        columns: [...DEFAULT_LAYOUT.columns, DEFAULT_LAYOUT.columns[0]],
      }),
    ).toEqual(DEFAULT_LAYOUT);
  });

  it("prints a line by column", () => {
    const line = {
      lineNo: 2,
      customerPosition: "Poz. 10",
      orderNumber: "RN-26-0007",
      partNumber: "DM-4711",
      drawingNumber: null,
      revision: "B",
      productName: "Osovina",
      quantity: "12",
      unit: "pcs",
    };
    const quantity = (v: string) => `${v} kom`;
    const unit = () => "kom";
    expect(columnValue("position", line, quantity, unit)).toBe("2");
    expect(columnValue("customer_position", line, quantity, unit)).toBe("Poz. 10");
    // Without a drawing number the part number is printed.
    expect(columnValue("drawing", line, quantity, unit)).toBe("DM-4711");
    expect(columnValue("quantity", line, quantity, unit)).toBe("12 kom");
  });

  it("logo paths stay in the organization folder", () => {
    const org = "11111111-1111-4111-8111-111111111111";
    const file = "22222222-2222-4222-8222-222222222222";
    expect(isLogoStoragePath(logoStoragePath(org, file, "png"), org)).toBe(true);
    expect(isLogoStoragePath(`${org}/../logo-${file}.png`, org)).toBe(false);
  });
});
