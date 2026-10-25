import { describe, expect, it } from "vitest";
import {
  allowedOrderTargets,
  canChangeOperationStatus,
  canChangeRouting,
  canEditPlanning,
  canEditSchedule,
  canTransition,
  isMaterialTransition,
  OPERATION_TRANSITIONS,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  requiresReason,
} from "./status-rules";

const manager = { manage: true, material: false };
const warehouse = { manage: false, material: true };
const reader = { manage: false, material: false };

describe("order status transitions", () => {
  it("allows the planned flow", () => {
    expect(canTransition("draft", "planned")).toBe(true);
    expect(canTransition("planned", "waiting_material")).toBe(true);
    expect(canTransition("waiting_material", "cutting")).toBe(true);
    expect(canTransition("cutting", "ready")).toBe(true);
    expect(canTransition("ready", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "paused")).toBe(true);
    expect(canTransition("paused", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "quality_check")).toBe(true);
    expect(canTransition("quality_check", "completed")).toBe(true);
    expect(canTransition("completed", "archived")).toBe(true);
    expect(canTransition("cancelled", "archived")).toBe(true);
  });

  it("forbids skipping steps and leaving closed states", () => {
    expect(canTransition("draft", "in_progress")).toBe(false);
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("in_progress", "completed")).toBe(false);
    expect(canTransition("in_progress", "ready")).toBe(false);
    expect(canTransition("cancelled", "draft")).toBe(false);
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(canTransition("quality_check", "cancelled")).toBe(false);
    expect(ORDER_TRANSITIONS.archived).toEqual([]);
  });

  it("never lists a status as its own target", () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("limits the warehouse and cutting workers to material statuses", () => {
    expect(isMaterialTransition("planned", "waiting_material")).toBe(true);
    expect(isMaterialTransition("waiting_material", "cutting")).toBe(true);
    expect(isMaterialTransition("cutting", "ready")).toBe(true);
    expect(isMaterialTransition("ready", "waiting_material")).toBe(true);
    expect(isMaterialTransition("ready", "in_progress")).toBe(false);
    expect(isMaterialTransition("draft", "planned")).toBe(false);
    expect(isMaterialTransition("cutting", "cancelled")).toBe(false);

    expect(allowedOrderTargets("waiting_material", warehouse)).toEqual(["cutting", "ready"]);
    expect(allowedOrderTargets("ready", warehouse)).toEqual(["waiting_material"]);
    expect(allowedOrderTargets("in_progress", warehouse)).toEqual([]);
    expect(allowedOrderTargets("draft", warehouse)).toEqual([]);
  });

  it("gives managers every transition and readers none", () => {
    expect(allowedOrderTargets("ready", manager)).toEqual([
      "waiting_material",
      "in_progress",
      "cancelled",
    ]);
    expect(allowedOrderTargets("ready", reader)).toEqual([]);
  });

  it("asks for a reason only when cancelling", () => {
    expect(requiresReason("cancelled")).toBe(true);
    expect(requiresReason("paused")).toBe(false);
  });

  it("decides what can be edited per status", () => {
    expect(canEditPlanning("draft")).toBe(true);
    expect(canEditPlanning("planned")).toBe(true);
    expect(canEditPlanning("cutting")).toBe(false);
    expect(canEditSchedule("in_progress")).toBe(true);
    expect(canEditSchedule("cancelled")).toBe(false);
    expect(canChangeRouting("draft")).toBe(true);
    expect(canChangeRouting("planned")).toBe(false);
    expect(canChangeOperationStatus("draft")).toBe(false);
    expect(canChangeOperationStatus("ready")).toBe(true);
    expect(canChangeOperationStatus("completed")).toBe(false);
  });
});

describe("operation status transitions", () => {
  it("follows waiting → ready → in progress ⇄ paused → done", () => {
    expect(OPERATION_TRANSITIONS.waiting).toEqual(["ready"]);
    expect(OPERATION_TRANSITIONS.ready).toContain("in_progress");
    expect(OPERATION_TRANSITIONS.in_progress).toEqual(["paused", "done"]);
    expect(OPERATION_TRANSITIONS.paused).toContain("in_progress");
    expect(OPERATION_TRANSITIONS.done).toEqual(["in_progress"]);
    expect(OPERATION_TRANSITIONS.waiting).not.toContain("done");
  });
});
