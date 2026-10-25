import { describe, expect, it } from "vitest";
import {
  attachmentMetaSchema,
  copyProductSchema,
  createProductSchema,
  operationTypeSchema,
  productionSettingsSchema,
  productSchema,
  revisionLabelSchema,
  toOperationRow,
  toProductRpcArgs,
  validOperationSchema,
  type ProductFormValues,
} from "./schemas";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";

const VALID: ProductFormValues = {
  partNumber: " 4711-02 ",
  name: " Osovina ",
  customerId: UUID2,
  productTypeId: "",
  unit: "pcs",
  inspectionPlan: "final",
  revision: " a ",
  drawingNumber: " C-100 ",
  description: "",
  materialId: UUID,
  blankGeometry: "round",
  blankDiameter: "40",
  blankWidth: "",
  blankThickness: "",
  cutLength: "120,5",
  kerf: "2,5",
  netMass: "1,2345",
};

const issues = (values: Partial<ProductFormValues>) =>
  productSchema.safeParse({ ...VALID, ...values }).error?.issues.map((i) => i.path[0]) ?? [];

describe("product schemas", () => {
  it("normalises text, decimals and the revision label", () => {
    expect(createProductSchema.parse(VALID)).toMatchObject({
      partNumber: "4711-02",
      name: "Osovina",
      customerId: UUID2,
      productTypeId: null,
      inspectionPlan: "final",
      revision: "A",
      drawingNumber: "C-100",
      materialId: UUID,
      blankGeometry: "round",
      blankDiameter: "40",
      blankWidth: null,
      cutLength: "120.5",
      kerf: "2.5",
      netMass: "1.2345",
    });
  });

  it("allows a first revision without a label", () => {
    expect(createProductSchema.parse({ ...VALID, revision: "  " }).revision).toBeNull();
    expect(createProductSchema.safeParse({ ...VALID, revision: "A B" }).success).toBe(false);
  });

  it("maps to the RPC JSON shape", () => {
    const args = toProductRpcArgs(productSchema.parse(VALID), "A");
    expect(args.product).toEqual({
      part_number: "4711-02",
      name: "Osovina",
      customer_id: UUID2,
      product_type_id: null,
      unit: "pcs",
      inspection_plan: "final",
    });
    expect(args.revision).toMatchObject({
      revision: "A",
      material_id: UUID,
      blank_geometry: "round",
      blank_diameter_mm: "40",
      cut_length_mm: "120.5",
      kerf_mm: "2.5",
      net_mass_kg: "1.2345",
    });
    expect(toProductRpcArgs(productSchema.parse(VALID)).revision).not.toHaveProperty("revision");
  });

  it("accepts only the dimensions of the chosen shape", () => {
    expect(issues({})).toEqual([]);
    expect(issues({ blankWidth: "5" })).toEqual(["blankWidth"]);
    expect(issues({ blankGeometry: "hexagon", blankThickness: "5" })).toEqual(["blankThickness"]);
    expect(
      issues({
        blankGeometry: "rectangular",
        blankDiameter: "",
        blankWidth: "50",
        blankThickness: "10",
      }),
    ).toEqual([]);
    expect(issues({ blankGeometry: "rectangular" })).toEqual(["blankDiameter"]);
    expect(issues({ blankGeometry: "", blankDiameter: "" })).toEqual([]);
    expect(issues({ blankGeometry: "other" })).toEqual(["blankDiameter"]);
  });

  it("requires a tube wall thinner than half the diameter", () => {
    expect(issues({ blankGeometry: "tube", blankThickness: "5" })).toEqual([]);
    expect(issues({ blankGeometry: "tube", blankThickness: "20" })).toEqual(["blankThickness"]);
  });

  it("rejects non-positive and malformed numbers", () => {
    expect(issues({ cutLength: "0" })).toEqual(["cutLength"]);
    expect(issues({ kerf: "0" })).toEqual([]);
    expect(issues({ netMass: "1,23456" })).toEqual(["netMass"]);
    expect(issues({ blankDiameter: "abc" })).toEqual(["blankDiameter"]);
    expect(issues({ inspectionPlan: "sometimes" as "none" })).toEqual(["inspectionPlan"]);
  });

  it("validates revision labels for new revisions", () => {
    expect(revisionLabelSchema.parse("b1")).toBe("B1");
    expect(revisionLabelSchema.safeParse("").success).toBe(false);
    expect(revisionLabelSchema.safeParse("ABCDEFGHIJK").success).toBe(false);
  });

  it("copies with an optional revision label", () => {
    expect(
      copyProductSchema.parse({ partNumber: "X", name: "Y", revision: "" }).revision,
    ).toBeNull();
  });
});

describe("operation schema", () => {
  const OP = {
    operationTypeId: UUID,
    description: "",
    resource: `machine:${UUID2}`,
    externalCompany: "",
    setupTime: "30",
    cycleTime: "1,5",
    cycleUnit: "min" as const,
    notes: "",
  };

  it("converts the cycle time to seconds and splits the resource", () => {
    const parsed = validOperationSchema.parse(OP);
    expect(parsed.cycleTimeSeconds).toBe("90");
    expect(parsed.resource).toEqual({ machineTypeId: null, machineId: UUID2 });
    expect(
      validOperationSchema.parse({ ...OP, cycleTime: "45", cycleUnit: "s" }).cycleTimeSeconds,
    ).toBe("45");
    expect(validOperationSchema.parse({ ...OP, resource: `type:${UUID}` }).resource).toEqual({
      machineTypeId: UUID,
      machineId: null,
    });
    expect(validOperationSchema.parse({ ...OP, cycleTime: "" }).cycleTimeSeconds).toBeNull();
  });

  it("rejects invalid numbers and resources", () => {
    const opIssues = (values: Partial<typeof OP>) =>
      validOperationSchema.safeParse({ ...OP, ...values }).error?.issues.map((i) => i.path[0]) ??
      [];
    expect(opIssues({ cycleTime: "0" })).toEqual(["cycleTime"]);
    expect(opIssues({ cycleTime: "1,2345" })).toEqual(["cycleTime"]);
    expect(opIssues({ resource: "machine:x" })).toEqual(["resource"]);
    expect(opIssues({ operationTypeId: "" })).toEqual(["operationTypeId"]);
  });

  it("drops machine and times for external operations, keeps decimals as strings", () => {
    const parsed = validOperationSchema.parse({ ...OP, externalCompany: " Cinkara " });
    expect(toOperationRow(parsed, true)).toMatchObject({
      machine_id: null,
      machine_type_id: null,
      setup_time_min: null,
      cycle_time_s: null,
      external_company: "Cinkara",
    });
    expect(toOperationRow(parsed, false)).toMatchObject({
      machine_id: UUID2,
      setup_time_min: "30",
      cycle_time_s: "90",
      external_company: null,
    });
  });
});

describe("operation type schema", () => {
  const TYPE = {
    name: "Brušenje unutrašnje",
    code: " bu ",
    isExternal: false,
    isInspection: false,
    isCutting: false,
  };

  it("upper-cases the abbreviation", () => {
    expect(operationTypeSchema.parse(TYPE)).toEqual({ ...TYPE, code: "BU" });
    expect(operationTypeSchema.parse({ ...TYPE, code: "čš" }).code).toBe("ČŠ");
  });

  it("rejects long or malformed abbreviations", () => {
    expect(operationTypeSchema.safeParse({ ...TYPE, code: "ABCDEFGHIJK" }).success).toBe(false);
    expect(operationTypeSchema.safeParse({ ...TYPE, code: "B U" }).success).toBe(false);
  });

  it("an inspection is done in-house", () => {
    expect(operationTypeSchema.safeParse({ ...TYPE, isInspection: true }).success).toBe(true);
    expect(
      operationTypeSchema.safeParse({ ...TYPE, isInspection: true, isExternal: true }).success,
    ).toBe(false);
  });

  it("cutting is an in-house production step", () => {
    expect(operationTypeSchema.safeParse({ ...TYPE, isCutting: true }).success).toBe(true);
    expect(
      operationTypeSchema.safeParse({ ...TYPE, isCutting: true, isExternal: true }).success,
    ).toBe(false);
    expect(
      operationTypeSchema.safeParse({ ...TYPE, isCutting: true, isInspection: true }).success,
    ).toBe(false);
  });
});

describe("production settings", () => {
  it("accepts the known units and inspection modes", () => {
    expect(
      productionSettingsSchema.parse({ cycleTimeUnit: "s", inspectionMode: "custom" }),
    ).toEqual({ cycleTimeUnit: "s", inspectionMode: "custom" });
    expect(
      productionSettingsSchema.safeParse({ cycleTimeUnit: "min", inspectionMode: "always" })
        .success,
    ).toBe(false);
  });
});

describe("attachment meta", () => {
  const META = {
    revisionId: UUID,
    kind: "main_drawing" as const,
    title: "",
    mainDrawingId: "",
    operationId: "",
    fileName: "crtez.pdf",
    contentType: "application/pdf",
    size: 1024,
  };

  it("accepts allowed files", () => {
    expect(attachmentMetaSchema.safeParse(META).success).toBe(true);
    expect(attachmentMetaSchema.safeParse({ ...META, contentType: "image/webp" }).success).toBe(
      true,
    );
  });

  it("rejects other types and files over 20 MB", () => {
    expect(
      attachmentMetaSchema.safeParse({ ...META, contentType: "application/zip" }).success,
    ).toBe(false);
    expect(attachmentMetaSchema.safeParse({ ...META, size: 20 * 1024 * 1024 + 1 }).success).toBe(
      false,
    );
  });

  it("requires a main drawing exactly for machine drawings", () => {
    expect(attachmentMetaSchema.safeParse({ ...META, kind: "machine_drawing" }).success).toBe(
      false,
    );
    expect(
      attachmentMetaSchema.safeParse({
        ...META,
        kind: "machine_drawing",
        mainDrawingId: UUID2,
        operationId: UUID,
      }).success,
    ).toBe(true);
    expect(attachmentMetaSchema.safeParse({ ...META, mainDrawingId: UUID2 }).success).toBe(false);
    expect(attachmentMetaSchema.safeParse({ ...META, operationId: UUID2 }).success).toBe(false);
  });
});
