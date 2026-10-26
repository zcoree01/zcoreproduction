import { describe, expect, it } from "vitest";
import { daySummary, dayWorkers, filterDay, type ProductionDay } from "./day-rules";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const W1 = "33333333-3333-4333-8333-333333333333";
const W2 = "44444444-4444-4444-8444-444444444444";

const report = (over: Partial<ProductionDay["reports"][number]>) => ({
  id: crypto.randomUUID(),
  at: "2026-10-26T08:00:00Z",
  orderId: "o1",
  orderNumber: "RN1-4326-002",
  operationCode: "TO",
  machineId: M1,
  machineCode: "CNC-01",
  employeeId: W1,
  employeeName: "Omer Operater",
  good: "10",
  scrap: "0",
  scrapReason: null,
  voided: false,
  ...over,
});

const downtime = (over: Partial<ProductionDay["downtime"][number]>) => ({
  id: crypto.randomUUID(),
  startedAt: "2026-10-26T09:00:00Z",
  endedAt: "2026-10-26T09:10:00Z",
  seconds: "600",
  orderId: "o1",
  orderNumber: "RN1-4326-002",
  operationCode: "TO",
  machineId: M1,
  machineCode: "CNC-01",
  employeeId: W1,
  employeeName: "Omer Operater",
  reason: "Kvar mašine",
  source: "pause" as const,
  notes: null,
  ...over,
});

const day: ProductionDay = {
  reports: [
    report({ good: "10", scrap: "2" }),
    report({ good: "5", scrap: "0", voided: true }),
    report({
      orderNumber: "RN2-4326-010",
      machineId: M2,
      employeeId: W2,
      employeeName: "Benjamin Bravar",
      good: "8",
    }),
  ],
  downtime: [
    downtime({}),
    downtime({ reason: "Izmjena alata", seconds: "300" }),
    downtime({ endedAt: null, seconds: "120", machineId: M2, reason: "Kvar mašine" }),
  ],
  working: [],
  toolChanges: [],
};

describe("daySummary", () => {
  it("counts good and scrap separately, without voided reports", () => {
    const summary = daySummary(day);
    expect(summary.good).toBe("18");
    expect(summary.scrap).toBe("2");
    expect(summary.scrapRate).toBe("10");
    expect(summary.reports).toBe(2);
  });

  it("sums downtime by reason and counts open downtime", () => {
    const summary = daySummary(day);
    expect(summary.downtimeSeconds).toBe("1020");
    expect(summary.downtimeByReason[0]).toEqual({
      reason: "Kvar mašine",
      seconds: "720",
      count: 2,
    });
    expect(summary.openDowntime).toBe(1);
  });
});

describe("filterDay", () => {
  it("filters by machine, worker and part of the order number", () => {
    expect(filterDay(day, { machine: M2, worker: null, order: "" }).reports).toHaveLength(1);
    expect(filterDay(day, { machine: null, worker: W1, order: "" }).reports).toHaveLength(2);
    expect(filterDay(day, { machine: null, worker: null, order: "rn2" }).reports).toHaveLength(1);
    expect(filterDay(day, { machine: M1, worker: null, order: "" }).downtime).toHaveLength(2);
  });
});

describe("dayWorkers", () => {
  it("lists every worker once, by name", () => {
    expect(dayWorkers(day)).toEqual([
      { id: W2, name: "Benjamin Bravar" },
      { id: W1, name: "Omer Operater" },
    ]);
  });
});
