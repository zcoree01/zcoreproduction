import { describe, expect, it } from "vitest";
import {
  attachmentMetaSchema,
  createProductSchema,
  operationTypeSchema,
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
  customerName: "",
  productTypeId: "",
  unit: "pcs",
  revision: " a ",
  drawingNumber: " C-100 ",
  description: "",
  materialGrade: "C45",
  materialShapeId: UUID,
  blankGeometry: "round",
  blankDiameter: "40",
  blankWidth: "",
  blankHeight: "120,5",
  blankThickness: "",
  cutLength: "123",
  kerf: "2,5",
  netMass: "1,2345",
};

describe("product schemas", () => {
  it("normalises text, decimals and the revision label", () => {
    const parsed = createProductSchema.parse(VALID);
    expect(parsed).toMatchObject({
      partNumber: "4711-02",
      name: "Osovina",
      customerName: null,
      productTypeId: null,
      revision: "A",
      drawingNumber: "C-100",
      blankGeometry: "round",
      blankDiameter: "40",
      blankHeight: "120.5",
      blankWidth: null,
      kerf: "2.5",
      netMass: "1.2345",
    });
  });

  it("maps to the RPC JSON shape", () => {
    const args = toProductRpcArgs(productSchema.parse(VALID), "A");
    expect(args.product).toEqual({
      part_number: "4711-02",
      name: "Osovina",
      customer_name: null,
      product_type_id: null,
      unit: "pcs",
    });
    expect(args.revision).toMatchObject({
      revision: "A",
      blank_diameter_mm: "40",
      blank_height_mm: "120.5",
      kerf_mm: "2.5",
      net_mass_kg: "1.2345",
    });
    expect(toProductRpcArgs(productSchema.parse(VALID)).revision).not.toHaveProperty("revision");
  });

  it("enforces dimensions per blank geometry", () => {
    const issues = (values: Partial<ProductFormValues>) =>
      productSchema.safeParse({ ...VALID, ...values }).error?.issues.map((i) => i.path[0]) ?? [];
    expect(issues({ blankThickness: "5" })).toEqual(["blankThickness"]);
    expect(issues({ blankGeometry: "prismatic", blankThickness: "5" })).toEqual(["blankDiameter"]);
    expect(issues({ blankGeometry: "prismatic", blankDiameter: "", blankThickness: "5" })).toEqual(
      [],
    );
    expect(issues({ blankGeometry: "", blankDiameter: "", blankHeight: "" })).toEqual([]);
    expect(issues({ blankGeometry: "" })).toEqual(["blankDiameter", "blankHeight"]);
  });

  it("rejects non-positive and malformed numbers", () => {
    const issues = (values: Partial<ProductFormValues>) =>
      productSchema.safeParse({ ...VALID, ...values }).error?.issues.map((i) => i.path[0]) ?? [];
    expect(issues({ cutLength: "0" })).toEqual(["cutLength"]);
    expect(issues({ kerf: "0" })).toEqual([]);
    expect(issues({ netMass: "1,23456" })).toEqual(["netMass"]);
    expect(issues({ blankDiameter: "abc" })).toEqual(["blankDiameter"]);
  });

  it("validates revision labels", () => {
    expect(revisionLabelSchema.parse("b1")).toBe("B1");
    expect(revisionLabelSchema.safeParse("A B").success).toBe(false);
    expect(revisionLabelSchema.safeParse("ABCDEFGHIJK").success).toBe(false);
  });
});

describe("operation schema", () => {
  const OP = {
    sequence: "20",
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
    expect(parsed.sequence).toBe(20);
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
    const issues = (values: Partial<typeof OP>) =>
      validOperationSchema.safeParse({ ...OP, ...values }).error?.issues.map((i) => i.path[0]) ??
      [];
    expect(issues({ sequence: "0" })).toEqual(["sequence"]);
    expect(issues({ sequence: "10000" })).toEqual(["sequence"]);
    expect(issues({ cycleTime: "0" })).toEqual(["cycleTime"]);
    expect(issues({ cycleTime: "1,2345" })).toEqual(["cycleTime"]);
    expect(issues({ resource: "machine:x" })).toEqual(["resource"]);
  });

  it("drops machine and times for external operations", () => {
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
  it("upper-cases the abbreviation", () => {
    expect(
      operationTypeSchema.parse({ name: "Brušenje unutrašnje", code: " bu ", isExternal: false }),
    ).toEqual({
      name: "Brušenje unutrašnje",
      code: "BU",
      isExternal: false,
    });
    expect(
      operationTypeSchema.parse({ name: "Čišćenje", code: "čš", isExternal: false }).code,
    ).toBe("ČŠ");
  });

  it("rejects long or malformed abbreviations", () => {
    expect(
      operationTypeSchema.safeParse({ name: "X", code: "ABCDEFGHIJK", isExternal: false }).success,
    ).toBe(false);
    expect(
      operationTypeSchema.safeParse({ name: "X", code: "B U", isExternal: false }).success,
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
