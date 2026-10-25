import { describe, expect, it } from "vitest";
import {
  assignmentSchema,
  createOrderSchema,
  orderSettingsSchema,
  quantityFitsUnit,
  toOrderRpcArgs,
} from "./schemas";

const ID = "5b7a1f6e-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const ORDER = {
  customerId: ID,
  productId: ID,
  revisionId: "",
  quantity: "100",
  dueDate: "2026-11-30",
  priority: "",
  plannedStart: "",
  plannedEnd: "",
  notes: "",
  pieceLength: "30",
  kerf: "2,5",
  barLength: "",
  barRemnant: "",
};

describe("order form", () => {
  it("normalises values and keeps decimals as strings", () => {
    const parsed = createOrderSchema.parse({ ...ORDER, quantity: "12,5", priority: "2" });
    expect(toOrderRpcArgs(parsed)).toEqual({
      customer_id: ID,
      product_id: ID,
      revision_id: null,
      quantity: "12.5",
      due_date: "2026-11-30",
      priority: 2,
      planned_start: null,
      planned_end: null,
      notes: null,
      piece_length_mm: "30",
      kerf_mm: "2.5",
      bar_length_mm: null,
      bar_remnant_mm: null,
    });
  });

  it("requires a positive quantity, a due date and ordered planned dates", () => {
    const issues = (values: Partial<typeof ORDER>) =>
      createOrderSchema
        .safeParse({ ...ORDER, ...values })
        .error?.issues.map((issue) => issue.path[0]) ?? [];
    expect(issues({ quantity: "0" })).toEqual(["quantity"]);
    expect(issues({ quantity: "" })).toEqual(["quantity"]);
    expect(issues({ dueDate: "" })).toEqual(["dueDate"]);
    expect(issues({ priority: "6" })).toEqual(["priority"]);
    expect(issues({ plannedStart: "2026-11-10", plannedEnd: "2026-11-09" })).toEqual([
      "plannedEnd",
    ]);
    expect(issues({ barLength: "3000", barRemnant: "3000" })).toEqual(["barRemnant"]);
  });

  it("allows decimals only for units that are not counted in pieces", () => {
    expect(quantityFitsUnit("12.5", "pcs")).toBe(false);
    expect(quantityFitsUnit("12", "pcs")).toBe(true);
    expect(quantityFitsUnit("1.5", "set")).toBe(false);
    expect(quantityFitsUnit("12.5", "kg")).toBe(true);
    expect(quantityFitsUnit("0.75", "m")).toBe(true);
  });
});

describe("assignment", () => {
  it("accepts an optional machine, unique workers and ordered times", () => {
    expect(
      assignmentSchema.parse({
        machineId: ID,
        employeeIds: [ID],
        plannedStart: "2026-11-02T06:00",
        plannedEnd: "2026-11-02T14:00",
      }),
    ).toEqual({
      machineId: ID,
      employeeIds: [ID],
      plannedStart: "2026-11-02T06:00",
      plannedEnd: "2026-11-02T14:00",
    });
    expect(
      assignmentSchema.safeParse({
        machineId: "",
        employeeIds: [ID, ID],
        plannedStart: "",
        plannedEnd: "",
      }).success,
    ).toBe(false);
    expect(
      assignmentSchema.safeParse({
        machineId: "",
        employeeIds: [],
        plannedStart: "2026-11-02T14:00",
        plannedEnd: "2026-11-02T06:00",
      }).success,
    ).toBe(false);
  });
});

describe("order settings", () => {
  const SETTINGS = {
    numberTemplate: "RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}",
    numberDigits: "3",
    priorityMode: "automatic",
    priorityThresholds: ["0", "3", "7", "10"],
    dueWarningDays: ["3", "10", "7", "7"],
    workHoursPerDay: "8",
  };

  it("parses numbers and sorts warning days", () => {
    expect(orderSettingsSchema.parse(SETTINGS)).toEqual({
      numberTemplate: "RN{KUPAC}-{SEDMICA}{GODINA}-{BROJ}",
      numberDigits: 3,
      priorityMode: "automatic",
      priorityThresholds: [0, 3, 7, 10],
      dueWarningDays: [10, 7, 3],
      workHoursPerDay: 8,
    });
  });

  it("rejects templates without a sequence or year and unordered thresholds", () => {
    expect(
      orderSettingsSchema.safeParse({ ...SETTINGS, numberTemplate: "RN-{BROJ}" }).success,
    ).toBe(false);
    expect(
      orderSettingsSchema.safeParse({ ...SETTINGS, priorityThresholds: ["5", "3", "7", "10"] })
        .success,
    ).toBe(false);
    expect(orderSettingsSchema.safeParse({ ...SETTINGS, dueWarningDays: [] }).success).toBe(false);
    expect(orderSettingsSchema.safeParse({ ...SETTINGS, workHoursPerDay: "25" }).success).toBe(
      false,
    );
  });
});
