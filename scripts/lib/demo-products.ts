// Demo operation types, a customer and one product with a routing for the
// "demo" organization. DEMO ONLY (seeded by `npm run seed:demo`). Idempotent:
// rows are matched by operation code, customer name and part number and never
// duplicated. Materials come from the migration's starter list.
import type { SupabaseClient } from "@supabase/supabase-js";
import { numericParam } from "@/lib/supabase/numeric";
import type { Database } from "@/lib/supabase/types";
import type { ProvisionedOrganization } from "@/modules/organizations/provision";

type Admin = SupabaseClient<Database>;

const OPERATION_TYPES = [
  { code: "RZ", name: "Rezanje", isExternal: false, isInspection: false },
  { code: "TO", name: "Tokarenje", isExternal: false, isInspection: false },
  { code: "GL", name: "Glodanje", isExternal: false, isInspection: false },
  { code: "BS", name: "Bušenje", isExternal: false, isInspection: false },
  { code: "BU", name: "Brušenje unutrašnje", isExternal: false, isInspection: false },
  { code: "KT", name: "Kontrola", isExternal: false, isInspection: true },
  { code: "CI", name: "Cinčanje", isExternal: true, isInspection: false },
] as const;

const CUSTOMER = { name: "Demo Kupac d.o.o.", city: "Zenica", country: "Bosna i Hercegovina" };

const PRODUCT = {
  partNumber: "DM-4711-02",
  name: "Osovina Ø40",
  revision: "A",
  drawingNumber: "C-4711",
  material: "C45",
  geometry: "round",
  diameter: "45",
  cutLength: "125",
  kerf: "2",
  netMass: "1.25",
  // Final inspection is part of the routing itself (inspection plan "none").
  operations: [
    { sequence: 1, code: "RZ", machine: "PILA-01", setupMin: "5", cycleS: "60" },
    { sequence: 2, code: "TO", machine: "CNC-02", setupMin: "30", cycleS: "95" },
    { sequence: 3, code: "GL", machine: "CNC-01", setupMin: "20", cycleS: "140" },
    { sequence: 4, code: "CI", external: "Cinkara Zenica" },
    { sequence: 5, code: "KT", setupMin: "0", cycleS: "30" },
  ],
} as const;

export async function seedDemoProducts(admin: Admin, org: ProvisionedOrganization) {
  const typeIds = new Map<string, string>();
  for (const type of OPERATION_TYPES) {
    const existing = await admin
      .from("operation_types")
      .select("id, is_inspection")
      .eq("organization_id", org.id)
      .eq("code", type.code)
      .is("archived_at", null)
      .maybeSingle()
      .throwOnError();
    if (existing.data && existing.data.is_inspection !== type.isInspection) {
      await admin
        .from("operation_types")
        .update({ is_inspection: type.isInspection })
        .eq("id", existing.data.id)
        .throwOnError();
    }
    const id =
      existing.data?.id ??
      (
        await admin
          .from("operation_types")
          .insert({
            organization_id: org.id,
            code: type.code,
            name: type.name,
            is_external: type.isExternal,
            is_inspection: type.isInspection,
          })
          .select("id")
          .single()
          .throwOnError()
      ).data.id;
    typeIds.set(type.code, id);
  }

  const existingCustomer = await admin
    .from("customers")
    .select("id")
    .eq("organization_id", org.id)
    .eq("name", CUSTOMER.name)
    .is("archived_at", null)
    .maybeSingle()
    .throwOnError();
  const customerId =
    existingCustomer.data?.id ??
    (
      await admin
        .from("customers")
        .insert({ organization_id: org.id, ...CUSTOMER })
        .select("id")
        .single()
        .throwOnError()
    ).data.id;

  const existing = await admin
    .from("products")
    .select("id")
    .eq("organization_id", org.id)
    .eq("part_number", PRODUCT.partNumber)
    .is("archived_at", null)
    .maybeSingle()
    .throwOnError();
  if (existing.data) return;

  const [productType, material, machines] = await Promise.all([
    admin
      .from("catalog_items")
      .select("id")
      .eq("organization_id", org.id)
      .eq("kind", "product_type")
      .eq("name", "Gotov proizvod")
      .is("archived_at", null)
      .single()
      .throwOnError(),
    admin
      .from("materials")
      .select("id")
      .eq("organization_id", org.id)
      .eq("designation", PRODUCT.material)
      .is("archived_at", null)
      .single()
      .throwOnError(),
    admin
      .from("machines")
      .select("id, code")
      .eq("organization_id", org.id)
      .is("archived_at", null)
      .throwOnError(),
  ]);
  const machineId = (code: string) => {
    const id = machines.data.find((machine) => machine.code === code)?.id;
    if (!id) throw new Error(`Demo machine missing: ${code}`);
    return id;
  };
  const typeId = (code: string) => {
    const id = typeIds.get(code);
    if (!id) throw new Error(`Demo operation type missing: ${code}`);
    return id;
  };

  const product = await admin
    .from("products")
    .insert({
      organization_id: org.id,
      part_number: PRODUCT.partNumber,
      name: PRODUCT.name,
      customer_id: customerId,
      product_type_id: productType.data.id,
    })
    .select("id")
    .single()
    .throwOnError();

  const revision = await admin
    .from("product_revisions")
    .insert({
      organization_id: org.id,
      product_id: product.data.id,
      revision: PRODUCT.revision,
      is_current: true,
      drawing_number: PRODUCT.drawingNumber,
      material_id: material.data.id,
      blank_geometry: PRODUCT.geometry,
      blank_diameter_mm: numericParam(PRODUCT.diameter),
      cut_length_mm: numericParam(PRODUCT.cutLength),
      kerf_mm: numericParam(PRODUCT.kerf),
      net_mass_kg: numericParam(PRODUCT.netMass),
    })
    .select("id")
    .single()
    .throwOnError();

  await admin
    .from("product_operations")
    .insert(
      PRODUCT.operations.map((operation) => ({
        organization_id: org.id,
        revision_id: revision.data.id,
        sequence: operation.sequence,
        operation_type_id: typeId(operation.code),
        machine_id: "machine" in operation ? machineId(operation.machine) : null,
        external_company: "external" in operation ? operation.external : null,
        setup_time_min: numericParam("setupMin" in operation ? operation.setupMin : null),
        cycle_time_s: numericParam("cycleS" in operation ? operation.cycleS : null),
      })),
    )
    .throwOnError();
}
