import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { setupFixture, type Fixture, type Tenant } from "./fixtures";

// Products, customers, materials, revisions, operations (incl. generated
// inspections), attachments and the product-files bucket: tenant isolation,
// permissions, revision locking and the product RPCs. Rows created here use
// the DBT prefix and are removed before and after the run.

const MARK = "DBT";
const BUCKET = "product-files";
const PDF = new Blob(["%PDF-1.4\n% DBT test\n"], { type: "application/pdf" });

type TenantData = {
  internalTypeId: string;
  externalTypeId: string;
  inspectionTypeId: string;
  customerId: string;
  materialId: string;
  productId: string;
  revisionId: string;
  machineId: string;
};

let fx: Fixture;
const data: Record<"a" | "b", TenantData> = {} as Record<"a" | "b", TenantData>;

function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

async function cleanup(service: SupabaseClient<Database>, orgIds: string[]) {
  const products = await service
    .from("products")
    .select("id, organization_id")
    .in("organization_id", orgIds)
    .like("part_number", `${MARK}-%`);
  const productIds = (products.data ?? []).map((row) => row.id);
  if (productIds.length > 0) {
    const revisions = await service
      .from("product_revisions")
      .select("id")
      .in("product_id", productIds);
    const revisionIds = (revisions.data ?? []).map((row) => row.id);
    if (revisionIds.length > 0) {
      // Machine drawings reference main drawings: remove them first.
      await service
        .from("product_attachments")
        .delete()
        .in("revision_id", revisionIds)
        .eq("kind", "machine_drawing");
      await service.from("product_attachments").delete().in("revision_id", revisionIds);
      await service.from("product_operations").delete().in("revision_id", revisionIds);
      await service.from("product_revisions").delete().in("id", revisionIds);
    }
    await service.from("products").delete().in("id", productIds);
    for (const product of products.data ?? []) {
      const folder = `${product.organization_id}/${product.id}`;
      const files = await service.storage.from(BUCKET).list(folder);
      const paths = (files.data ?? []).map((file) => `${folder}/${file.name}`);
      if (paths.length > 0) await service.storage.from(BUCKET).remove(paths);
    }
  }
  await service
    .from("operation_types")
    .delete()
    .in("organization_id", orgIds)
    .like("code", `${MARK}%`);
  await service.from("machines").delete().in("organization_id", orgIds).like("code", `${MARK}-P%`);
  await service.from("customers").delete().in("organization_id", orgIds).like("name", `${MARK} %`);
  await service
    .from("materials")
    .delete()
    .in("organization_id", orgIds)
    .like("designation", `${MARK} %`);
}

async function seedTenant(tenant: Tenant): Promise<TenantData> {
  const org = tenant.org.id;
  const types = await fx.service
    .from("operation_types")
    .insert([
      {
        organization_id: org,
        code: `${MARK}TO`,
        name: `${MARK} Tokarenje`,
        is_external: false,
        is_inspection: false,
      },
      {
        organization_id: org,
        code: `${MARK}CI`,
        name: `${MARK} Cinčanje`,
        is_external: true,
        is_inspection: false,
      },
      {
        organization_id: org,
        code: `${MARK}KT`,
        name: `${MARK} Kontrola`,
        is_external: false,
        is_inspection: true,
      },
    ])
    .select("id, code")
    .throwOnError();
  const typeId = (code: string) => types.data.find((t) => t.code === `${MARK}${code}`)!.id;
  const machine = await fx.service
    .from("machines")
    .insert({ organization_id: org, code: `${MARK}-P01`, name: "Product test machine" })
    .select("id")
    .single()
    .throwOnError();
  const customer = await fx.service
    .from("customers")
    .insert({ organization_id: org, name: `${MARK} Kupac` })
    .select("id")
    .single()
    .throwOnError();
  // Starter list seeded by the migration for every organization.
  const material = await fx.service
    .from("materials")
    .select("id")
    .eq("organization_id", org)
    .eq("designation", "C45")
    .is("archived_at", null)
    .single()
    .throwOnError();

  // Created through the RPC as the tenant's admin (products.manage).
  const created = await tenant.admin.rpc("create_product", {
    p_org_id: org,
    p_product: {
      part_number: `${MARK}-1000`,
      name: "Osovina",
      customer_id: customer.data.id,
      unit: "pcs",
    },
    p_revision: {
      revision: "A",
      drawing_number: "C-1000",
      material_id: material.data.id,
      blank_geometry: "round",
      blank_diameter_mm: "40",
      cut_length_mm: "120.5",
      kerf_mm: "2.5",
      net_mass_kg: "1.2345",
    },
  });
  expect(created.error).toBeNull();
  const revision = await fx.service
    .from("product_revisions")
    .select("id")
    .eq("product_id", created.data!)
    .single()
    .throwOnError();

  return {
    internalTypeId: typeId("TO"),
    externalTypeId: typeId("CI"),
    inspectionTypeId: typeId("KT"),
    customerId: customer.data.id,
    materialId: material.data.id,
    productId: created.data!,
    revisionId: revision.data.id,
    machineId: machine.data.id,
  };
}

/** Type codes of the active routing in order, generated inspections marked with "*". */
async function routing(client: SupabaseClient<Database>, revisionId: string) {
  const { data: rows, error } = await client
    .from("product_operations")
    .select("sequence, auto_inspection, description, type:operation_types(code)")
    .eq("revision_id", revisionId)
    .is("archived_at", null)
    .order("sequence");
  expect(error).toBeNull();
  return (rows ?? []).map((row) => {
    const code = (row.type?.code ?? "").replace(MARK, "");
    return row.auto_inspection ? `${code}*` : (row.description ?? code);
  });
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  data.a = await seedTenant(fx.a);
  data.b = await seedTenant(fx.b);
});

afterAll(async () => {
  if (fx) await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

const TABLES = [
  "operation_types",
  "products",
  "product_revisions",
  "product_directory",
  "customers",
  "material_groups",
  "materials",
] as const;

describe("products: tenant isolation and permissions", () => {
  it.each(TABLES)("admin A sees only tenant A rows in %s", async (table) => {
    const { data: rows, error } = await untyped(fx.a.admin).from(table).select("organization_id");
    expect(error).toBeNull();
    expect(rows?.length).toBeGreaterThan(0);
    expect(new Set(rows?.map((row: { organization_id: string }) => row.organization_id))).toEqual(
      new Set([fx.a.org.id]),
    );
  });

  it("every organization gets the starter material list with densities", async () => {
    const { data: rows } = await fx.a.admin
      .from("materials")
      .select("designation, density_kg_dm3, group:material_groups(name, density_kg_dm3)")
      .in("designation", ["C45", "1.4404 (AISI 316L)"])
      .order("designation");
    expect(rows).toEqual([
      {
        designation: "1.4404 (AISI 316L)",
        density_kg_dm3: 8,
        group: { name: "Nehrđajući čelik (inox)", density_kg_dm3: 7.9 },
      },
      { designation: "C45", density_kg_dm3: null, group: { name: "Čelik", density_kg_dm3: 7.85 } },
    ]);
  });

  it("stores decimals exactly and links customer and material", async () => {
    const { data: row } = await fx.a.admin
      .from("product_directory")
      .select("customer_name, material_designation, material_group_name")
      .eq("id", data.a.productId)
      .single();
    expect(row).toEqual({
      customer_name: `${MARK} Kupac`,
      material_designation: "C45",
      material_group_name: "Čelik",
    });
    const { data: revision } = await fx.a.admin
      .from("product_revisions")
      .select("cut_length_mm, kerf_mm, net_mass_kg")
      .eq("id", data.a.revisionId)
      .single();
    expect(revision).toEqual({ cut_length_mm: 120.5, kerf_mm: 2.5, net_mass_kg: 1.2345 });
  });

  it("operators cannot read products or customers yet", async () => {
    expect((await fx.a.operator.from("products").select("id")).data).toEqual([]);
    expect((await fx.a.operator.from("customers").select("id")).data).toEqual([]);
    const created = await fx.a.operator.rpc("create_product", {
      p_org_id: fx.a.org.id,
      p_product: { part_number: `${MARK}-OP`, name: "Nope" },
      p_revision: {},
    });
    expect(created.error?.code).toBe("42501");
    const customer = await fx.a.operator
      .from("customers")
      .insert({ organization_id: fx.a.org.id, name: `${MARK} Nope` });
    expect(customer.error?.code).toBe("42501");
  });

  it("admin A cannot create in tenant B or use B's customer or material", async () => {
    const created = await fx.a.admin.rpc("create_product", {
      p_org_id: fx.b.org.id,
      p_product: { part_number: `${MARK}-X`, name: "Intruder" },
      p_revision: {},
    });
    expect(created.error?.code).toBe("42501");

    const updated = await fx.a.admin.rpc("update_product", {
      p_product_id: data.b.productId,
      p_product: { part_number: `${MARK}-1000`, name: "hacked" },
      p_revision: {},
    });
    expect(updated.error?.code).toBe("P0002");

    const foreignCustomer = await fx.a.admin.rpc("create_product", {
      p_org_id: fx.a.org.id,
      p_product: { part_number: `${MARK}-X1`, name: "X", customer_id: data.b.customerId },
      p_revision: {},
    });
    expect(foreignCustomer.error?.code).toBe("23503");
    const foreignMaterial = await fx.a.admin.rpc("create_product", {
      p_org_id: fx.a.org.id,
      p_product: { part_number: `${MARK}-X2`, name: "X" },
      p_revision: { material_id: data.b.materialId },
    });
    expect(foreignMaterial.error?.code).toBe("23503");
  });

  it("part numbers are unique among active products; revision labels are optional", async () => {
    const duplicate = await fx.a.admin.rpc("create_product", {
      p_org_id: fx.a.org.id,
      p_product: { part_number: ` ${MARK.toLowerCase()}-1000 `, name: "Duplikat" },
      p_revision: {},
    });
    expect(duplicate.error?.code).toBe("23505");
    expect(duplicate.error?.message).toContain("products_part_number_key");

    const unlabeled = await fx.a.admin.rpc("create_product", {
      p_org_id: fx.a.org.id,
      p_product: { part_number: `${MARK}-3000`, name: "Bez revizije" },
      p_revision: { revision: "" },
    });
    expect(unlabeled.error).toBeNull();
    const revision = await fx.a.admin
      .from("product_revisions")
      .select("revision, is_current")
      .eq("product_id", unlabeled.data!)
      .single();
    expect(revision.data).toEqual({ revision: null, is_current: true });

    const needsLabel = await fx.a.admin.rpc("create_product_revision", {
      p_product_id: unlabeled.data!,
      p_revision: " ",
    });
    expect(needsLabel.error?.code).toBe("22023");
  });

  it("rejects dimensions that do not fit the blank shape", async () => {
    const update = (revision: Record<string, string>) =>
      fx.a.admin.rpc("update_product", {
        p_product_id: data.a.productId,
        p_product: { part_number: `${MARK}-1000`, name: "Osovina", customer_id: data.a.customerId },
        p_revision: { material_id: data.a.materialId, cut_length_mm: "120.5", ...revision },
      });
    expect((await update({ blank_geometry: "round", blank_thickness_mm: "5" })).error?.code).toBe(
      "23514",
    );
    expect(
      (await update({ blank_geometry: "tube", blank_diameter_mm: "40", blank_thickness_mm: "20" }))
        .error?.code,
    ).toBe("23514");
    expect((await update({ blank_geometry: "round", blank_diameter_mm: "40" })).error).toBeNull();
  });
});

describe("operations and inspections", () => {
  const save = (operation: Record<string, unknown>, id: string | null = null) =>
    fx.a.admin.rpc("save_product_operation", {
      p_revision_id: data.a.revisionId,
      p_operation_id: id as string,
      p_operation: operation as never,
    });
  const setPlan = (plan: string) =>
    fx.a.admin.rpc("update_product", {
      p_product_id: data.a.productId,
      p_product: {
        part_number: `${MARK}-1000`,
        name: "Osovina",
        customer_id: data.a.customerId,
        inspection_plan: plan,
      },
      p_revision: {
        material_id: data.a.materialId,
        blank_geometry: "round",
        blank_diameter_mm: "40",
        cut_length_mm: "120.5",
        kerf_mm: "2.5",
        net_mass_kg: "1.2345",
      },
    });
  let first: string;
  let second: string;
  let external: string;

  it("appends operations and rejects machines on external ones", async () => {
    const a = await save({
      operation_type_id: data.a.internalTypeId,
      description: "first",
      machine_id: data.a.machineId,
      setup_time_min: "30",
      cycle_time_s: "90",
    });
    const b = await save({ operation_type_id: data.a.internalTypeId, description: "second" });
    const bad = await save({
      operation_type_id: data.a.externalTypeId,
      machine_id: data.a.machineId,
    });
    const c = await save({
      operation_type_id: data.a.externalTypeId,
      description: "external",
      external_company: "Cinkara",
    });
    expect([a.error, b.error, c.error]).toEqual([null, null, null]);
    expect(bad.error?.code).toBe("23514");
    first = a.data!;
    second = b.data!;
    external = c.data!;
    expect(await routing(fx.a.admin, data.a.revisionId)).toEqual(["first", "second", "external"]);
  });

  it("places generated inspections after every operation or only at the end", async () => {
    expect((await setPlan("between")).error).toBeNull();
    expect(await routing(fx.a.admin, data.a.revisionId)).toEqual([
      "first",
      "KT*",
      "second",
      "KT*",
      "external",
      "KT*",
    ]);
    expect((await setPlan("final")).error).toBeNull();
    expect(await routing(fx.a.admin, data.a.revisionId)).toEqual([
      "first",
      "second",
      "external",
      "KT*",
    ]);
    // A manual inspection at the end replaces the generated final one.
    const manual = await save({
      operation_type_id: data.a.inspectionTypeId,
      description: "manual KT",
    });
    expect(await routing(fx.a.admin, data.a.revisionId)).toEqual([
      "first",
      "second",
      "external",
      "manual KT",
    ]);
    expect(
      (
        await fx.a.admin.rpc("set_product_operation_archived", {
          p_operation_id: manual.data!,
          p_archived: true,
        })
      ).error,
    ).toBeNull();
    expect((await setPlan("between")).error).toBeNull();
  });

  it("reorders manual operations and re-places the inspections", async () => {
    const reordered = await fx.a.admin.rpc("reorder_product_operations", {
      p_revision_id: data.a.revisionId,
      p_operation_ids: [second, external, first],
    });
    expect(reordered.error).toBeNull();
    expect(await routing(fx.a.admin, data.a.revisionId)).toEqual([
      "second",
      "KT*",
      "external",
      "KT*",
      "first",
      "KT*",
    ]);
    const incomplete = await fx.a.admin.rpc("reorder_product_operations", {
      p_revision_id: data.a.revisionId,
      p_operation_ids: [first, second],
    });
    expect(incomplete.error?.code).toBe("22023");
  });

  it("generated inspections cannot be edited, archived or deleted by hand", async () => {
    const { data: auto } = await fx.a.admin
      .from("product_operations")
      .select("id")
      .eq("revision_id", data.a.revisionId)
      .eq("auto_inspection", true)
      .limit(1)
      .single();
    const edited = await save({ operation_type_id: data.a.internalTypeId }, auto!.id);
    expect(edited.error?.code).toBe("P0002");
    const archived = await fx.a.admin.rpc("set_product_operation_archived", {
      p_operation_id: auto!.id,
      p_archived: true,
    });
    expect(archived.error?.code).toBe("P0002");
    const deletedManual = await fx.a.admin
      .from("product_operations")
      .delete()
      .eq("id", first)
      .select("id");
    expect(deletedManual.data).toEqual([]);
  });

  it("reports a missing inspection type", async () => {
    await fx.service
      .from("operation_types")
      .update({ is_inspection: false })
      .eq("id", data.a.inspectionTypeId)
      .throwOnError();
    const result = await setPlan("final");
    expect(result.error?.message).toContain("inspection_type_missing");
    await fx.service
      .from("operation_types")
      .update({ is_inspection: true })
      .eq("id", data.a.inspectionTypeId)
      .throwOnError();
  });

  it("an operation cannot use another tenant's operation type or machine", async () => {
    expect((await save({ operation_type_id: data.b.internalTypeId })).error?.code).toBe("23503");
    expect(
      (await save({ operation_type_id: data.a.internalTypeId, machine_id: data.b.machineId })).error
        ?.code,
    ).toBe("23503");
  });
});

describe("revisions", () => {
  let mainDrawingId: string;
  let revisionB: string;

  it("stores attachments only in the tenant's own folder, readable by the same tenant", async () => {
    const path = `${fx.a.org.id}/${data.a.productId}/${randomUUID()}.pdf`;
    const upload = await fx.a.admin.storage
      .from(BUCKET)
      .upload(path, PDF, { contentType: "application/pdf" });
    expect(upload.error).toBeNull();

    const foreign = await fx.a.admin.storage
      .from(BUCKET)
      .upload(`${fx.b.org.id}/${data.b.productId}/${randomUUID()}.pdf`, PDF, {
        contentType: "application/pdf",
      });
    expect(foreign.error).not.toBeNull();

    const byOperator = await fx.a.operator.storage
      .from(BUCKET)
      .upload(`${fx.a.org.id}/${data.a.productId}/${randomUUID()}.pdf`, PDF, {
        contentType: "application/pdf",
      });
    expect(byOperator.error).not.toBeNull();

    const wrongType = await fx.a.admin.storage
      .from(BUCKET)
      .upload(`${fx.a.org.id}/${data.a.productId}/${randomUUID()}.pdf`, new Blob(["x"]), {
        contentType: "application/zip",
      });
    expect(wrongType.error).not.toBeNull();

    expect((await fx.a.admin.storage.from(BUCKET).download(path)).error).toBeNull();
    expect((await fx.b.admin.storage.from(BUCKET).download(path)).error).not.toBeNull();

    const crossPath = await fx.b.admin.from("product_attachments").insert({
      organization_id: fx.b.org.id,
      revision_id: data.b.revisionId,
      kind: "main_drawing",
      file_name: "steal.pdf",
      storage_path: path,
      content_type: "application/pdf",
      size_bytes: 10,
    });
    expect(crossPath.error?.code).toBe("23514");

    const main = await fx.a.admin
      .from("product_attachments")
      .insert({
        organization_id: fx.a.org.id,
        revision_id: data.a.revisionId,
        kind: "main_drawing",
        file_name: "glavni.pdf",
        storage_path: path,
        content_type: "application/pdf",
        size_bytes: PDF.size,
      })
      .select("id")
      .single();
    expect(main.error).toBeNull();
    mainDrawingId = main.data!.id;

    const machineDrawing = await fx.a.admin.from("product_attachments").insert({
      organization_id: fx.a.org.id,
      revision_id: data.a.revisionId,
      kind: "machine_drawing",
      main_drawing_id: mainDrawingId,
      file_name: "cnc.pdf",
      storage_path: `${fx.a.org.id}/${data.a.productId}/${randomUUID()}.pdf`,
      content_type: "application/pdf",
      size_bytes: 10,
    });
    expect(machineDrawing.error).toBeNull();
  });

  it("a new revision copies data, operations and attachments and locks the old one", async () => {
    const before = await routing(fx.a.admin, data.a.revisionId);
    const created = await fx.a.admin.rpc("create_product_revision", {
      p_product_id: data.a.productId,
      p_revision: "B",
    });
    expect(created.error).toBeNull();
    revisionB = created.data!;

    const revisions = await fx.a.admin
      .from("product_revisions")
      .select("id, revision, is_current, material_id")
      .eq("product_id", data.a.productId)
      .order("revision");
    expect(revisions.data).toEqual([
      { id: data.a.revisionId, revision: "A", is_current: false, material_id: data.a.materialId },
      { id: revisionB, revision: "B", is_current: true, material_id: data.a.materialId },
    ]);
    expect(await routing(fx.a.admin, revisionB)).toEqual(before);

    const attachmentsB = await fx.a.admin
      .from("product_attachments")
      .select("kind, main_drawing_id")
      .eq("revision_id", revisionB);
    expect(attachmentsB.data?.length).toBe(2);
    const newMachine = attachmentsB.data?.find((a) => a.kind === "machine_drawing");
    expect(newMachine?.main_drawing_id).not.toBe(mainDrawingId);

    const duplicate = await fx.a.admin.rpc("create_product_revision", {
      p_product_id: data.a.productId,
      p_revision: "b",
    });
    expect(duplicate.error?.code).toBe("23505");
  });

  it("the old revision and its operations cannot be changed", async () => {
    const revision = await fx.a.admin
      .from("product_revisions")
      .update({ drawing_number: "changed" })
      .eq("id", data.a.revisionId)
      .select("id");
    expect(revision.error?.code).toBe("55000");

    const operation = await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: data.a.revisionId,
      p_operation_id: null as unknown as string,
      p_operation: { operation_type_id: data.a.internalTypeId },
    });
    expect(operation.error?.code).toBe("55000");
  });

  it("an older revision can be made current again", async () => {
    const restored = await fx.a.admin.rpc("set_current_revision", {
      p_revision_id: data.a.revisionId,
    });
    expect(restored.error).toBeNull();
    const current = await fx.a.admin
      .from("product_revisions")
      .select("revision")
      .eq("product_id", data.a.productId)
      .eq("is_current", true)
      .single();
    expect(current.data?.revision).toBe("A");

    const back = await fx.a.admin.rpc("set_current_revision", { p_revision_id: revisionB });
    expect(back.error).toBeNull();
  });

  it("copying makes a new product with operations but without attachments", async () => {
    const copied = await fx.a.admin.rpc("copy_product", {
      p_source_revision_id: revisionB,
      p_part_number: `${MARK}-2000`,
      p_name: "Osovina kopija",
      p_revision: "",
    });
    expect(copied.error).toBeNull();
    const revision = await fx.a.admin
      .from("product_revisions")
      .select(
        "id, revision, is_current, material_id, product:products(customer_id, inspection_plan)",
      )
      .eq("product_id", copied.data!)
      .single();
    expect(revision.data).toMatchObject({
      revision: null,
      is_current: true,
      material_id: data.a.materialId,
      product: { customer_id: data.a.customerId, inspection_plan: "between" },
    });
    expect(await routing(fx.a.admin, revision.data!.id)).toEqual(
      await routing(fx.a.admin, revisionB),
    );
    const attachments = await fx.a.admin
      .from("product_attachments")
      .select("id")
      .eq("revision_id", revision.data!.id);
    expect(attachments.data).toEqual([]);
  });

  it("history is visible with products.read and hidden from other tenants", async () => {
    const history = await fx.a.admin.rpc("product_history", { p_product_id: data.a.productId });
    expect(history.error).toBeNull();
    const actions = new Set(history.data?.map((entry) => entry.action));
    expect(actions).toContain("products.insert");
    expect(actions).toContain("products.revision_created");
    expect(actions).toContain("products.revision_restored");
    expect(actions).toContain("products.routing_reordered");
    expect(actions).toContain("product_operations.insert");

    const foreign = await fx.b.admin.rpc("product_history", { p_product_id: data.a.productId });
    expect(foreign.data).toEqual([]);
    const operator = await fx.a.operator.rpc("product_history", { p_product_id: data.a.productId });
    expect(operator.data).toEqual([]);
  });

  it("archived products are locked until restored", async () => {
    await fx.a.admin
      .from("products")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.a.productId)
      .throwOnError();
    const operation = await fx.a.admin.rpc("save_product_operation", {
      p_revision_id: revisionB,
      p_operation_id: null as unknown as string,
      p_operation: { operation_type_id: data.a.internalTypeId },
    });
    expect(operation.error?.code).toBe("55000");
    const revision = await fx.a.admin.rpc("create_product_revision", {
      p_product_id: data.a.productId,
      p_revision: "C",
    });
    expect(revision.error?.code).toBe("P0002");
    await fx.a.admin
      .from("products")
      .update({ archived_at: null })
      .eq("id", data.a.productId)
      .throwOnError();
  });
});
