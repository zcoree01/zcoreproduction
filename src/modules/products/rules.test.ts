import { describe, expect, it } from "vitest";
import {
  attachmentStoragePath,
  changedFields,
  cycleUnitFromSettings,
  describeHistoryEntry,
  isProductStoragePath,
  minutesToSeconds,
  nextRevisionLabel,
  operationSeconds,
  resolveCycleUnit,
  routingTotals,
  secondsToUnit,
  splitDuration,
} from "./rules";

const ORG = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";

describe("nextRevisionLabel", () => {
  it("increments letters", () => {
    expect(nextRevisionLabel("A")).toBe("B");
    expect(nextRevisionLabel("c")).toBe("D");
    expect(nextRevisionLabel("Z")).toBe("AA");
    expect(nextRevisionLabel("AZ")).toBe("BA");
  });

  it("increments numbers and keeps padding", () => {
    expect(nextRevisionLabel("01")).toBe("02");
    expect(nextRevisionLabel("09")).toBe("10");
    expect(nextRevisionLabel("A1")).toBe("A2");
    expect(nextRevisionLabel("1.9")).toBe("1.10");
  });

  it("skips labels that already exist", () => {
    expect(nextRevisionLabel("A", ["A", "B", "c"])).toBe("D");
  });

  it("returns null when no rule applies or the label gets too long", () => {
    expect(nextRevisionLabel("A-")).toBeNull();
    expect(nextRevisionLabel("ZZZZZZZZZZ")).toBeNull();
  });
});

describe("cycle times", () => {
  it("converts minutes to seconds exactly", () => {
    expect(minutesToSeconds("1.5")).toBe("90");
    expect(minutesToSeconds("0.01")).toBe("0.6");
  });

  it("shows seconds in the chosen unit", () => {
    expect(secondsToUnit("90", "min")).toBe("1.5");
    expect(secondsToUnit("7", "min")).toBe("0.117");
    expect(secondsToUnit("7.50", "s")).toBe("7.5");
  });

  it("uses the machine unit before the organization default", () => {
    expect(resolveCycleUnit("s", "min")).toBe("s");
    expect(resolveCycleUnit(null, "min")).toBe("min");
  });

  it("reads the organization default from settings", () => {
    expect(cycleUnitFromSettings({})).toBe("min");
    expect(cycleUnitFromSettings({ cycle_time_unit: "s" })).toBe("s");
    expect(cycleUnitFromSettings({ cycle_time_unit: "h" })).toBe("min");
    expect(cycleUnitFromSettings(null)).toBe("min");
  });
});

describe("durations", () => {
  const turning = { setupTimeMin: "30", cycleTimeS: "90" };

  it("counts setup once and cycle per piece", () => {
    expect(operationSeconds(turning, "1")).toBe("1890");
    expect(operationSeconds(turning, "100")).toBe("10800");
    expect(operationSeconds({ setupTimeMin: null, cycleTimeS: null }, "100")).toBe("0");
  });

  it("totals a routing", () => {
    expect(
      routingTotals([
        turning,
        { setupTimeMin: "15.5", cycleTimeS: "12.5" },
        { setupTimeMin: null, cycleTimeS: null },
      ]),
    ).toEqual({ setupSeconds: "2730", cycleSecondsPerPiece: "102.5" });
  });

  it("splits seconds for display", () => {
    expect(splitDuration("10800")).toEqual({ hours: 3, minutes: 0, seconds: 0 });
    expect(splitDuration("102.5")).toEqual({ hours: 0, minutes: 1, seconds: 43 });
  });
});

describe("attachment paths", () => {
  it("builds and recognises product paths", () => {
    const path = attachmentStoragePath(ORG, PRODUCT, FILE, "pdf");
    expect(path).toBe(`${ORG}/${PRODUCT}/${FILE}.pdf`);
    expect(isProductStoragePath(path, ORG, PRODUCT)).toBe(true);
  });

  it("rejects other organizations, products and file names", () => {
    expect(isProductStoragePath(`${PRODUCT}/${PRODUCT}/${FILE}.pdf`, ORG, PRODUCT)).toBe(false);
    expect(isProductStoragePath(`${ORG}/${FILE}/${FILE}.pdf`, ORG, PRODUCT)).toBe(false);
    expect(isProductStoragePath(`${ORG}/${PRODUCT}/../x.pdf`, ORG, PRODUCT)).toBe(false);
    expect(isProductStoragePath(`${ORG}/${PRODUCT}/${FILE}.exe`, ORG, PRODUCT)).toBe(false);
  });
});

describe("history", () => {
  it("lists changed fields and ignores bookkeeping columns", () => {
    expect(
      changedFields(
        { name: "A", unit: "pcs", updated_at: "1", customer_name: null },
        { name: "B", unit: "pcs", updated_at: "2", customer_name: "Kupac" },
      ),
    ).toEqual(["customer_name", "name"]);
  });

  it("describes product updates, archiving and copies", () => {
    expect(
      describeHistoryEntry({
        action: "products.update",
        entityType: "products",
        before: { name: "A", part_number: "P-1" },
        after: { name: "B", part_number: "P-1" },
      }),
    ).toEqual({ event: "product_updated", fields: ["name"], subject: "P-1" });
    expect(
      describeHistoryEntry({
        action: "products.update",
        entityType: "products",
        before: { archived_at: null, part_number: "P-1" },
        after: { archived_at: "2026-10-24", part_number: "P-1" },
      })?.event,
    ).toBe("product_archived");
    expect(
      describeHistoryEntry({
        action: "products.copied",
        entityType: "products",
        before: { part_number: "P-1" },
        after: { part_number: "P-2" },
      }),
    ).toEqual({ event: "product_copied", fields: [], subject: "P-1" });
  });

  it("hides switching the current-revision flag", () => {
    expect(
      describeHistoryEntry({
        action: "product_revisions.update",
        entityType: "product_revisions",
        before: { is_current: true, revision: "A" },
        after: { is_current: false, revision: "A" },
      }),
    ).toBeNull();
  });

  it("names operations by number and attachments by file", () => {
    expect(
      describeHistoryEntry({
        action: "product_operations.update",
        entityType: "product_operations",
        before: { sequence: 20, archived_at: null },
        after: { sequence: 20, archived_at: "x" },
      }),
    ).toEqual({ event: "operation_archived", fields: [], subject: "20" });
    expect(
      describeHistoryEntry({
        action: "product_attachments.insert",
        entityType: "product_attachments",
        before: null,
        after: { file_name: "crtez.pdf" },
      }),
    ).toEqual({ event: "attachment_added", fields: [], subject: "crtez.pdf" });
  });

  it("ignores unknown actions", () => {
    expect(
      describeHistoryEntry({ action: "x.y", entityType: "x", before: null, after: null }),
    ).toBeNull();
  });
});
