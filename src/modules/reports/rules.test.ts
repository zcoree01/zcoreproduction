import { describe, expect, it } from "vitest";
import type { InventoryFacts, OrderFact, ProductionFacts } from "./queries";
import {
  dailyGood,
  downtimeByReason,
  filterProduction,
  machineRows,
  materialConsumption,
  orderRows,
  orderSummary,
  onTimeByCustomer,
  productionRows,
  scrapByReason,
  stockValuation,
  toolConsumption,
} from "./rules";

const CNC = "11111111-1111-4111-8111-111111111111";
const EDM = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const BEN = "44444444-4444-4444-8444-444444444444";
const ORDER_A = "55555555-5555-4555-8555-555555555555";
const ORDER_B = "66666666-6666-4666-8666-666666666666";
const OP_A = "77777777-7777-4777-8777-777777777777";
const OP_B = "88888888-8888-4888-8888-888888888888";
const CUSTOMER = "99999999-9999-4999-8999-999999999999";
const MON = "2030-05-06";
const TUE = "2030-05-07";

const facts: ProductionFacts = {
  output: [
    {
      day: MON,
      machine_id: CNC,
      employee_id: ANA,
      order_id: ORDER_A,
      operation_id: OP_A,
      good: "40",
      scrap: "2",
      planned_seconds: 3150,
    },
    {
      day: TUE,
      machine_id: CNC,
      employee_id: BEN,
      order_id: ORDER_A,
      operation_id: OP_A,
      good: "20",
      scrap: "0",
      planned_seconds: 1500,
    },
    {
      day: TUE,
      machine_id: EDM,
      employee_id: ANA,
      order_id: ORDER_B,
      operation_id: OP_B,
      good: "5",
      scrap: "1",
      planned_seconds: 7200,
    },
  ],
  scrap: [
    { day: MON, machine_id: CNC, employee_id: ANA, order_id: ORDER_A, reason: "Mjera", scrap: "2" },
    { day: TUE, machine_id: EDM, employee_id: ANA, order_id: ORDER_B, reason: null, scrap: "1" },
  ],
  machine_time: [
    { day: MON, machine_id: CNC, order_id: ORDER_A, operation_id: OP_A, seconds: 3600 },
    { day: TUE, machine_id: CNC, order_id: ORDER_A, operation_id: OP_A, seconds: 1800 },
    { day: TUE, machine_id: EDM, order_id: ORDER_B, operation_id: OP_B, seconds: 36_000 },
  ],
  worker_time: [
    {
      day: MON,
      employee_id: ANA,
      machine_id: CNC,
      order_id: ORDER_A,
      operation_id: OP_A,
      seconds: 4000,
    },
    {
      day: TUE,
      employee_id: BEN,
      machine_id: CNC,
      order_id: ORDER_A,
      operation_id: OP_A,
      seconds: 1800,
    },
  ],
  downtime: [
    {
      day: MON,
      machine_id: CNC,
      employee_id: ANA,
      order_id: ORDER_A,
      reason: "Čeka materijal",
      seconds: 1800,
    },
    {
      day: TUE,
      machine_id: CNC,
      employee_id: BEN,
      order_id: ORDER_A,
      reason: "Kvar",
      seconds: 3600,
    },
  ],
  tool_changes: [{ day: MON, machine_id: CNC, reason: "Istrošen", changes: 2, minutes: 15 }],
  machines: [
    {
      id: CNC,
      code: "CNC-01",
      name: "Glodalica",
      runs_unattended: false,
      capacity_hours: null,
      hourly_rate: "60",
      archived: false,
    },
    {
      id: EDM,
      code: "EDM-01",
      name: "Erozimat",
      runs_unattended: true,
      capacity_hours: 20,
      hourly_rate: null,
      archived: false,
    },
  ],
  employees: [
    { id: ANA, name: "Ana A", number: 1 },
    { id: BEN, name: "Ben B", number: 2 },
  ],
  orders: [
    {
      id: ORDER_A,
      number: "RN-1",
      customer_id: CUSTOMER,
      customer: "Kupac",
      part_number: "P-1",
      product: "Osovina",
    },
    {
      id: ORDER_B,
      number: "RN-2",
      customer_id: null,
      customer: null,
      part_number: "P-2",
      product: "Matrica",
    },
  ],
  operations: [],
};

describe("production report", () => {
  it("groups output by machine with running time, efficiency and good per hour", () => {
    const rows = productionRows(facts, "machine");
    expect(rows.map((r) => r.label)).toEqual(["EDM-01 · Erozimat", "CNC-01 · Glodalica"]);
    expect(rows[1]).toMatchObject({
      good: "60",
      scrap: "2",
      scrapRate: "3.2",
      seconds: 5400,
      plannedSeconds: 4650,
      efficiency: 86.1,
      goodPerHour: 40,
    });
  });

  it("uses the worker's own time when grouped by worker and sorts days by date", () => {
    const byWorker = productionRows(facts, "employee");
    expect(byWorker.find((r) => r.key === ANA)).toMatchObject({ good: "45", seconds: 4000 });
    expect(productionRows(facts, "day").map((r) => r.key)).toEqual([MON, TUE]);
    expect(
      productionRows(facts, "customer")
        .map((r) => r.label)
        .sort(),
    ).toEqual(["", "Kupac"]);
  });

  it("filters by machine, worker and customer", () => {
    const cnc = filterProduction(facts, { machine: CNC });
    expect(cnc.output).toHaveLength(2);
    expect(cnc.tool_changes).toHaveLength(1);
    const ana = filterProduction(facts, { employee: ANA });
    expect(ana.output).toHaveLength(2);
    expect(ana.machine_time).toEqual([]);
    expect(
      filterProduction(facts, { customer: CUSTOMER }).output.every((r) => r.order_id === ORDER_A),
    ).toBe(true);
  });

  it("lists every day and sums scrap and downtime by reason", () => {
    expect(dailyGood(facts, [MON, TUE, "2030-05-08"])).toEqual([
      { day: MON, good: "40" },
      { day: TUE, good: "25" },
      { day: "2030-05-08", good: "0" },
    ]);
    expect(scrapByReason(facts, "Bez razloga")).toEqual([
      { reason: "Mjera", scrap: "2" },
      { reason: "Bez razloga", scrap: "1" },
    ]);
    expect(downtimeByReason(facts)).toEqual([
      { reason: "Kvar", seconds: 3600 },
      { reason: "Čeka materijal", seconds: 1800 },
    ]);
  });
});

describe("machine report", () => {
  it("counts capacity on working days, every day when unattended, and the idle rest", () => {
    // Monday to Sunday: 5 working days.
    const days = [
      "2030-05-06",
      "2030-05-07",
      "2030-05-08",
      "2030-05-09",
      "2030-05-10",
      "2030-05-11",
      "2030-05-12",
    ];
    const rows = machineRows(facts, {
      days,
      holidays: new Set(["2030-05-08"]),
      workHoursPerDay: 8,
    });
    const cnc = rows.find((r) => r.id === CNC);
    expect(cnc).toMatchObject({
      capacitySeconds: 4 * 8 * 3600,
      runSeconds: 5400,
      downtimeSeconds: 5400,
      idleSeconds: 4 * 8 * 3600 - 10_800,
      utilization: 4.7,
      toolChanges: 2,
      toolChangeMinutes: 15,
    });
    expect(rows.find((r) => r.id === EDM)?.capacitySeconds).toBe(7 * 20 * 3600);
  });
});

const order = (overrides: Partial<OrderFact>): OrderFact => ({
  id: ORDER_A,
  number: "RN-1",
  status: "completed",
  customer_id: CUSTOMER,
  customer: "Kupac",
  part_number: "P-1",
  product: "Osovina",
  quantity: "100",
  unit: "pcs",
  good: "100",
  due_date: "2030-05-10",
  completed_on: "2030-05-09",
  planned_seconds: 3600,
  run_seconds: 4000,
  material_cost: "120.5",
  machine_cost: "66.6667",
  external_cost: "30",
  external_days: 3,
  rate_missing: false,
  ...overrides,
});

describe("order report", () => {
  it("counts days late, on-time share, costs and cost per piece", () => {
    const rows = orderRows(
      [
        order({}),
        order({ id: ORDER_B, number: "RN-2", completed_on: "2030-05-14", good: "0" }),
        order({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          number: "RN-3",
          status: "in_progress",
          completed_on: null,
        }),
      ],
      "2030-05-13",
      {},
    );
    expect(rows.map((r) => [r.number, r.lateDays, r.open])).toEqual([
      ["RN-1", 0, false],
      ["RN-2", 4, false],
      ["RN-3", 3, true],
    ]);
    expect(rows[0]).toMatchObject({ totalCost: "217.1667", costPerPiece: "2.17" });
    expect(rows[1]?.costPerPiece).toBeNull();
    expect(orderSummary(rows)).toEqual({
      completed: 2,
      onTime: 1,
      onTimePercent: 50,
      averageLateDays: 4,
      openLate: 1,
      totalCost: "651.5001",
    });
    expect(onTimeByCustomer(rows, "Bez kupca")).toEqual([
      { name: "Kupac", completed: 2, late: 1, lateDays: 4 },
    ]);
    expect(orderRows([order({})], "2030-05-13", { customer: ANA })).toEqual([]);
  });
});

describe("material and tools", () => {
  const inventory: InventoryFacts = {
    consumption: [
      {
        item_id: CNC,
        order_id: ORDER_A,
        order_number: "RN-1",
        quantity: "1250",
        mass_kg: "12.3",
        value: "40.2",
      },
      {
        item_id: CNC,
        order_id: ORDER_B,
        order_number: "RN-2",
        quantity: "-250",
        mass_kg: "-2.3",
        value: "-8.2",
      },
      {
        item_id: EDM,
        order_id: ORDER_A,
        order_number: "RN-1",
        quantity: "2",
        mass_kg: "1",
        value: "90",
      },
    ],
    receipts: [],
    stock: [
      { item_id: CNC, quantity: "6000", mass_kg: "59", value: "200" },
      { item_id: EDM, quantity: "10", mass_kg: "5", value: "450.25" },
    ],
    items: [
      { id: CNC, code: "C45-40", name: "Šipka Ø40", unit: "mm" },
      { id: EDM, code: "AL-10", name: "Lim 10", unit: "m2" },
    ],
    tools: [
      {
        tool_id: ANA,
        code: "VBMT",
        name: "Pločica",
        kind: "insert",
        machine_id: CNC,
        consumed: 4,
        scrapped: null,
      },
      {
        tool_id: ANA,
        code: "VBMT",
        name: "Pločica",
        kind: "insert",
        machine_id: EDM,
        consumed: 1,
        scrapped: 1,
      },
    ],
  };

  it("nets returns, values the stock and counts tools", () => {
    expect(materialConsumption(inventory, {})).toEqual([
      { itemId: EDM, label: "AL-10 · Lim 10", unit: "m2", quantity: "2", massKg: "1", value: "90" },
      {
        itemId: CNC,
        label: "C45-40 · Šipka Ø40",
        unit: "mm",
        quantity: "1000",
        massKg: "10",
        value: "32",
      },
    ]);
    expect(materialConsumption(inventory, { order: ORDER_B })[0]?.quantity).toBe("-250");
    expect(stockValuation(inventory).total).toBe("650.25");
    expect(toolConsumption(inventory)).toEqual([
      { code: "VBMT", name: "Pločica", kind: "insert", consumed: 5, scrapped: 1 },
    ]);
    expect(toolConsumption(inventory, CNC)[0]?.consumed).toBe(4);
  });
});
