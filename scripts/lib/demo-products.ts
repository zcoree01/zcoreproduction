// Demo operation types and one product with a routing for the "demo"
// organization. DEMO ONLY (seeded by `npm run seed:demo`). Idempotent: rows are
// matched by operation code and part number and never duplicated.
import type { SupabaseClient } from "@supabase/supabase-js";
import { numericParam } from "@/lib/supabase/numeric";
import type { Database } from "@/lib/supabase/types";
import type { ProvisionedOrganization } from "@/modules/organizations/provision";

type Admin = SupabaseClient<Database>;

const OPERATION_TYPES = [
  { code: "RZ", name: "Rezanje", isExternal: false },
  { code: "TO", name: "Tokarenje", isExternal: false },
  { code: "GL", name: "Glodanje", isExternal: false },
  { code: "BS", name: "Bušenje", isExternal: false },
  { code: "BU", name: "Brušenje unutrašnje", isExternal: false },
  { code: "KT", name: "Kontrola", isExternal: false },
  { code: "CI", name: "Cinčanje", isExternal: true },
] as const;

const PRODUCT = {
  partNumber: "DM-4711-02",
  name: "Osovina Ø40",
  customer: "Demo Kupac d.o.o.",
  revision: "A",
  drawingNumber: "C-4711",
  materialGrade: "C45",
  shape: "Šipka",
  geometry: "round",
  diameter: "45",
  height: "125",
  cutLength: "125",
  kerf: "2",
  netMass: "1.25",
  operations: [
    { sequence: 10, code: "RZ", machine: "PILA-01", setupMin: "5", cycleS: "60" },
    { sequence: 20, code: "TO", machine: "CNC-02", setupMin: "30", cycleS: "95" },
    { sequence: 30, code: "GL", machine: "CNC-01", setupMin: "20", cycleS: "140" },
    { sequence: 40, code: "CI", external: "Cinkara Zenica" },
    { sequence: 50, code: "KT", setupMin: "0", cycleS: "30" },
  ],
} as const;

export async function seedDemoProducts(admin: Admin, org: ProvisionedOrganization) {
  const typeIds = new Map<string, string>();
  for (const type of OPERATION_TYPES) {
    const existing = await admin
      .from("operation_types")
      .select("id")
      .eq("organization_id", org.id)
      .eq("code", type.code)
      .is("archived_at", null)
      .maybeSingle()
      .throwOnError();
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
          })
          .select("id")
          .single()
          .throwOnError()
      ).data.id;
    typeIds.set(type.code, id);
  }

  const existing = await admin
    .from("products")
    .select("id")
    .eq("organization_id", org.id)
    .eq("part_number", PRODUCT.partNumber)
    .is("archived_at", null)
    .maybeSingle()
    .throwOnError();
  if (existing.data) return;

  const [productType, shape, machines] = await Promise.all([
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
      .from("catalog_items")
      .select("id")
      .eq("organization_id", org.id)
      .eq("kind", "material_shape")
      .eq("name", PRODUCT.shape)
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
      customer_name: PRODUCT.customer,
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
      material_grade: PRODUCT.materialGrade,
      material_shape_id: shape.data.id,
      blank_geometry: PRODUCT.geometry,
      blank_diameter_mm: numericParam(PRODUCT.diameter),
      blank_height_mm: numericParam(PRODUCT.height),
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
