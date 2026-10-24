import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { setupFixture, type Fixture, type Tenant } from "./fixtures";

// Products, revisions, operations, attachments and the product-files bucket:
// tenant isolation, permissions, revision locking and the product RPCs. Rows
// created here use the DBT prefix and are removed before and after the run.

const MARK = "DBT";
const BUCKET = "product-files";
const PDF = new Blob(["%PDF-1.4\n% DBT test\n"], { type: "application/pdf" });

type TenantData = {
  internalTypeId: string;
  externalTypeId: string;
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
}

async function seedTenant(tenant: Tenant): Promise<TenantData> {
  const org = tenant.org.id;
  const types = await fx.service
    .from("operation_types")
    .insert([
      { organization_id: org, code: `${MARK}TO`, name: `${MARK} Tokarenje`, is_external: false },
      { organization_id: org, code: `${MARK}CI`, name: `${MARK} Cinčanje`, is_external: true },
    ])
    .select("id, is_external")
    .throwOnError();
  const machine = await fx.service
    .from("machines")
    .insert({ organization_id: org, code: `${MARK}-P01`, name: "Product test machine" })
    .select("id")
    .single()
    .throwOnError();

  // Created through the RPC as the tenant's admin (products.manage).
  const created = await tenant.admin.rpc("create_product", {
    p_org_id: org,
    p_product: {
      part_number: `${MARK}-1000`,
      name: "Osovina",
      customer_name: "Kupac",
      unit: "pcs",
    },
    p_revision: {
      revision: "A",
      drawing_number: "C-1000",
      material_grade: "C45",
      blank_geometry: "round",
      blank_diameter_mm: "40",
      blank_height_mm: "120.5",
      cut_length_mm: "123",
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
    internalTypeId: types.data.find((t) => !t.is_external)!.id,
    externalTypeId: types.data.find((t) => t.is_external)!.id,
    productId: created.data!,
    revisionId: revision.data.id,
    machineId: machine.data.id,
  };
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

const TABLES = ["operation_types", "products", "product_revisions", "product_directory"] as const;

describe("products: tenant isolation and permissions", () => {
  it.each(TABLES)("admin A sees only tenant A rows in %s", async (table) => {
    const { data: rows, error } = await untyped(fx.a.admin).from(table).select("organization_id");
    expect(error).toBeNull();
    expect(rows?.length).toBeGreaterThan(0);
    expect(new Set(rows?.map((row: { organization_id: string }) => row.organization_id))).toEqual(
      new Set([fx.a.org.id]),
    );
  });

  it("stores decimals exactly", async () => {
    const { data: row } = await fx.a.admin
      .from("product_revisions")
      .select("blank_height_mm, kerf_mm, net_mass_kg")
      .eq("id", data.a.revisionId)
      .single();
    expect(row).toEqual({ blank_height_mm: 120.5, kerf_mm: 2.5, net_mass_kg: 1.2345 });
  });

  it("operators cannot read products yet (access comes with production orders)", async () => {
    const { data: rows } = await fx.a.operator.from("products").select("id");
    expect(rows).toEqual([]);
    const created = await fx.a.operator.rpc("create_product", {
      p_org_id: fx.a.org.id,
      p_product: { part_number: `${MARK}-OP`, name: "Nope" },
      p_revision: { revision: "A" },
    });
    expect(created.error?.code).toBe("42501");
  });

  it("admin A cannot create products in tenant B or touch B's product", async () => {
    const created = await fx.a.admin.rpc("create_product", {
      p_org_id: fx.b.org.id,
      p_product: { part_number: `${MARK}-X`, name: "Intruder" },
      p_revision: { revision: "A" },
    });
    expect(created.error?.code).toBe("42501");

    const updated = await fx.a.admin.rpc("update_product", {
      p_product_id: data.b.productId,
      p_product: { part_number: `${MARK}-1000`, name: "hacked" },
      p_revision: {},
    });
    expect(updated.error?.code).toBe("P0002");
  });

  it("an operation cannot use another tenant's operation type or machine", async () => {
    const wrongType = await fx.a.admin.from("product_operations").insert({
      organization_id: fx.a.org.id,
      revision_id: data.a.revisionId,
      sequence: 900,
      operation_type_id: data.b.internalTypeId,
    });
    expect(wrongType.error?.code).toBe("23503");
    const wrongMachine = await fx.a.admin.from("product_operations").insert({
      organization_id: fx.a.org.id,
      revision_id: data.a.revisionId,
      sequence: 901,
      operation_type_id: data.a.internalTypeId,
      machine_id: data.b.machineId,
    });
    expect(wrongMachine.error?.code).toBe("23503");
  });

  it("part numbers are unique among active products", async () => {
    const duplicate = await fx.a.admin.rpc("create_product", {
      p_org_id: fx.a.org.id,
      p_product: { part_number: ` ${MARK.toLowerCase()}-1000 `, name: "Duplikat" },
      p_revision: { revision: "A" },
    });
    expect(duplicate.error?.code).toBe("23505");
    expect(duplicate.error?.message).toContain("products_part_number_key");
  });

  it("rejects dimensions that do not fit the blank geometry", async () => {
    const { error } = await fx.a.admin.rpc("update_product", {
      p_product_id: data.a.productId,
      p_product: { part_number: `${MARK}-1000`, name: "Osovina" },
      p_revision: { blank_geometry: "round", blank_thickness_mm: "5" },
    });
    expect(error?.code).toBe("23514");
  });
});

describe("operations", () => {
  it("external operations carry no machine or times", async () => {
    const bad = await fx.a.admin.from("product_operations").insert({
      organization_id: fx.a.org.id,
      revision_id: data.a.revisionId,
      sequence: 40,
      operation_type_id: data.a.externalTypeId,
      machine_id: data.a.machineId,
    });
    expect(bad.error?.code).toBe("23514");

    const good = await fx.a.admin.from("product_operations").insert({
      organization_id: fx.a.org.id,
      revision_id: data.a.revisionId,
      sequence: 40,
      operation_type_id: data.a.externalTypeId,
      external_company: "Cinkara",
    });
    expect(good.error).toBeNull();
  });

  it("sequence numbers are unique per revision and moving swaps them", async () => {
    const inserted = await fx.a.admin
      .from("product_operations")
      .insert([
        {
          organization_id: fx.a.org.id,
          revision_id: data.a.revisionId,
          sequence: 10,
          operation_type_id: data.a.internalTypeId,
          machine_id: data.a.machineId,
          setup_time_min: 30,
          cycle_time_s: 90,
        },
        {
          organization_id: fx.a.org.id,
          revision_id: data.a.revisionId,
          sequence: 20,
          operation_type_id: data.a.internalTypeId,
          description: "second",
        },
      ])
      .select("id, sequence");
    expect(inserted.error).toBeNull();
    const second = inserted.data!.find((op) => op.sequence === 20)!;

    const duplicate = await fx.a.admin.from("product_operations").insert({
      organization_id: fx.a.org.id,
      revision_id: data.a.revisionId,
      sequence: 20,
      operation_type_id: data.a.internalTypeId,
    });
    expect(duplicate.error?.code).toBe("23505");

    const moved = await fx.a.admin.rpc("move_product_operation", {
      p_operation_id: second.id,
      p_direction: -1,
    });
    expect(moved.error).toBeNull();
    const after = await fx.a.admin
      .from("product_operations")
      .select("sequence, description")
      .eq("revision_id", data.a.revisionId)
      .is("archived_at", null)
      .order("sequence");
    expect(after.data?.slice(0, 2).map((op) => op.description)).toEqual(["second", null]);
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
    const created = await fx.a.admin.rpc("create_product_revision", {
      p_product_id: data.a.productId,
      p_revision: "B",
    });
    expect(created.error).toBeNull();
    revisionB = created.data!;

    const revisions = await fx.a.admin
      .from("product_revisions")
      .select("id, revision, is_current, material_grade")
      .eq("product_id", data.a.productId)
      .order("revision");
    expect(revisions.data).toEqual([
      { id: data.a.revisionId, revision: "A", is_current: false, material_grade: "C45" },
      { id: revisionB, revision: "B", is_current: true, material_grade: "C45" },
    ]);

    const [opsA, opsB, attachmentsB] = await Promise.all([
      fx.a.admin
        .from("product_operations")
        .select("sequence")
        .eq("revision_id", data.a.revisionId)
        .is("archived_at", null),
      fx.a.admin.from("product_operations").select("sequence").eq("revision_id", revisionB),
      fx.a.admin
        .from("product_attachments")
        .select("kind, main_drawing_id")
        .eq("revision_id", revisionB),
    ]);
    expect(opsB.data?.map((op) => op.sequence).sort()).toEqual(
      opsA.data?.map((op) => op.sequence).sort(),
    );
    expect(attachmentsB.data?.length).toBe(2);
    const newMain = attachmentsB.data?.find((a) => a.kind === "main_drawing");
    const newMachine = attachmentsB.data?.find((a) => a.kind === "machine_drawing");
    expect(newMachine?.main_drawing_id).not.toBe(mainDrawingId);
    expect(newMain).toBeDefined();

    const duplicate = await fx.a.admin.rpc("create_product_revision", {
      p_product_id: data.a.productId,
      p_revision: "b",
    });
    expect(duplicate.error?.code).toBe("23505");
  });

  it("the old revision and its operations cannot be changed", async () => {
    const revision = await fx.a.admin
      .from("product_revisions")
      .update({ material_grade: "S235" })
      .eq("id", data.a.revisionId)
      .select("id");
    expect(revision.error?.code).toBe("55000");

    const operation = await fx.a.admin.from("product_operations").insert({
      organization_id: fx.a.org.id,
      revision_id: data.a.revisionId,
      sequence: 500,
      operation_type_id: data.a.internalTypeId,
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
      p_revision: "A",
    });
    expect(copied.error).toBeNull();
    const revision = await fx.a.admin
      .from("product_revisions")
      .select("id, revision, is_current, material_grade, product:products(customer_name)")
      .eq("product_id", copied.data!)
      .single();
    expect(revision.data).toMatchObject({
      revision: "A",
      is_current: true,
      material_grade: "C45",
      product: { customer_name: "Kupac" },
    });
    const [ops, attachments] = await Promise.all([
      fx.a.admin.from("product_operations").select("id").eq("revision_id", revision.data!.id),
      fx.a.admin.from("product_attachments").select("id").eq("revision_id", revision.data!.id),
    ]);
    expect(ops.data?.length).toBeGreaterThan(0);
    expect(attachments.data).toEqual([]);
  });

  it("history is visible with products.read and hidden from other tenants", async () => {
    const history = await fx.a.admin.rpc("product_history", { p_product_id: data.a.productId });
    expect(history.error).toBeNull();
    const actions = new Set(history.data?.map((entry) => entry.action));
    expect(actions).toContain("products.insert");
    expect(actions).toContain("products.revision_created");
    expect(actions).toContain("products.revision_restored");
    expect(actions).toContain("product_operations.insert");
    expect(
      history.data?.every(
        (entry) => entry.actor_username === "admin" || entry.actor_username === null,
      ),
    ).toBe(true);

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
    const operation = await fx.a.admin.from("product_operations").insert({
      organization_id: fx.a.org.id,
      revision_id: revisionB,
      sequence: 600,
      operation_type_id: data.a.internalTypeId,
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
