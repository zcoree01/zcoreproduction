import { describe, expect, it } from "vitest";
import { moveToolSchema, nextEdge, toolSchema } from "./schemas";

const ID = "11111111-1111-4111-8111-111111111111";
const tool = {
  code: "VBMT",
  name: "Pločica VBMT 160404",
  kind: "insert" as const,
  cuttingEdges: "3",
  homeMachineId: "",
  minStock: "10",
  supplier: "",
  notes: "",
};
const paths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => i.path.join(".")) ?? [];

describe("toolSchema", () => {
  it("inserts need cutting edges, other tools none", () => {
    expect(toolSchema.parse(tool).cuttingEdges).toBe(3);
    expect(paths(toolSchema.safeParse({ ...tool, cuttingEdges: "" }))).toEqual(["cuttingEdges"]);
    expect(paths(toolSchema.safeParse({ ...tool, kind: "tool" }))).toEqual(["cuttingEdges"]);
    expect(toolSchema.safeParse({ ...tool, kind: "tool", cuttingEdges: "" }).success).toBe(true);
    expect(paths(toolSchema.safeParse({ ...tool, cuttingEdges: "21" }))).toEqual(["cuttingEdges"]);
  });
});

describe("moveToolSchema", () => {
  const move = {
    idempotencyKey: ID,
    kind: "issue" as const,
    toolId: ID,
    quantity: "4",
    fromId: ID,
    toId: "",
    machineId: ID,
    reason: "",
  };

  it("checks what each kind of move needs", () => {
    expect(moveToolSchema.safeParse(move).success).toBe(true);
    expect(paths(moveToolSchema.safeParse({ ...move, machineId: "" }))).toEqual(["machineId"]);
    expect(paths(moveToolSchema.safeParse({ ...move, kind: "receipt", fromId: "" }))).toEqual([
      "toId",
    ]);
    expect(paths(moveToolSchema.safeParse({ ...move, kind: "scrap" }))).toEqual(["reason"]);
    expect(paths(moveToolSchema.safeParse({ ...move, quantity: "0" }))).toEqual(["quantity"]);
  });
});

describe("nextEdge", () => {
  it("turns until the last edge", () => {
    expect(nextEdge(1, 3)).toBe(2);
    expect(nextEdge(3, 3)).toBeNull();
    expect(nextEdge(null, 3)).toBeNull();
  });
});
