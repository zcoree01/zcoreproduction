// Demo machines, employees and catalogs for the "demo" organization.
// DEMO ONLY (seeded by `npm run seed:demo`). Idempotent: rows are matched by
// catalog name, machine code and employee number and never duplicated.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CatalogKind } from "@/modules/catalogs/schemas";
import type { ProvisionedOrganization } from "@/modules/organizations/provision";

type Admin = SupabaseClient<Database>;

const CATALOGS: Record<CatalogKind, string[]> = {
  machine_type: ["CNC glodalica", "CNC tokarilica", "Tračna pila"],
  location: ["Hala 1", "Hala 2"],
  department: ["CNC obrada", "Bravarija"],
  job_title: ["CNC operater", "Bravar"],
  skill: ["CNC programiranje", "Čitanje tehničkog crteža", "Zavarivanje TIG"],
  product_type: ["Gotov proizvod"],
};

const MACHINES = [
  {
    code: "CNC-01",
    name: "Vertikalni obradni centar",
    type: "CNC glodalica",
    manufacturer: "Haas",
    model: "VF-2",
    location: "Hala 1",
  },
  {
    code: "CNC-02",
    name: "Tokarski centar",
    type: "CNC tokarilica",
    manufacturer: "DMG Mori",
    model: "CLX 350",
    location: "Hala 1",
  },
  {
    code: "PILA-01",
    name: "Tračna pila",
    type: "Tračna pila",
    manufacturer: "Pegas",
    model: "300x320",
    location: "Hala 2",
  },
] as const;

const EMPLOYEES = [
  {
    number: 1,
    firstName: "Omer",
    lastName: "Operater",
    username: "operater",
    department: "CNC obrada",
    jobTitle: "CNC operater",
    skills: [
      { name: "CNC programiranje", level: 2 },
      { name: "Čitanje tehničkog crteža", level: 3 },
    ],
    machines: ["CNC-01", "CNC-02"],
  },
  {
    number: 2,
    firstName: "Benjamin",
    lastName: "Bravar",
    username: null,
    department: "Bravarija",
    jobTitle: "Bravar",
    skills: [{ name: "Zavarivanje TIG", level: 3 }],
    machines: ["PILA-01"],
  },
] as const;

export async function seedDemoProduction(admin: Admin, org: ProvisionedOrganization) {
  // Catalog items: name → id per kind.
  const ids = new Map<string, string>();
  for (const [kind, names] of Object.entries(CATALOGS) as [CatalogKind, string[]][]) {
    for (const name of names) {
      const existing = await admin
        .from("catalog_items")
        .select("id")
        .eq("organization_id", org.id)
        .eq("kind", kind)
        .eq("name", name)
        .is("archived_at", null)
        .maybeSingle()
        .throwOnError();
      const id =
        existing.data?.id ??
        (
          await admin
            .from("catalog_items")
            .insert({ organization_id: org.id, kind, name })
            .select("id")
            .single()
            .throwOnError()
        ).data.id;
      ids.set(`${kind}:${name}`, id);
    }
  }
  const item = (kind: CatalogKind, name: string) => {
    const id = ids.get(`${kind}:${name}`);
    if (!id) throw new Error(`Demo catalog item missing: ${kind} ${name}`);
    return id;
  };

  const machineIds = new Map<string, string>();
  for (const machine of MACHINES) {
    const existing = await admin
      .from("machines")
      .select("id")
      .eq("organization_id", org.id)
      .eq("code", machine.code)
      .is("archived_at", null)
      .maybeSingle()
      .throwOnError();
    const id =
      existing.data?.id ??
      (
        await admin
          .from("machines")
          .insert({
            organization_id: org.id,
            code: machine.code,
            name: machine.name,
            type_id: item("machine_type", machine.type),
            manufacturer: machine.manufacturer,
            model: machine.model,
            location_id: item("location", machine.location),
          })
          .select("id")
          .single()
          .throwOnError()
      ).data.id;
    machineIds.set(machine.code, id);
  }

  for (const employee of EMPLOYEES) {
    const existing = await admin
      .from("employees")
      .select("id")
      .eq("organization_id", org.id)
      .eq("employee_number", employee.number)
      .maybeSingle()
      .throwOnError();
    if (existing.data) continue;

    const user = employee.username
      ? (
          await admin
            .from("profiles")
            .select("id")
            .eq("organization_id", org.id)
            .eq("username", employee.username)
            .single()
            .throwOnError()
        ).data.id
      : null;

    const created = await admin
      .from("employees")
      .insert({
        organization_id: org.id,
        employee_number: employee.number,
        first_name: employee.firstName,
        last_name: employee.lastName,
        department_id: item("department", employee.department),
        job_title_id: item("job_title", employee.jobTitle),
        user_id: user,
      })
      .select("id")
      .single()
      .throwOnError();

    await admin
      .from("employee_skills")
      .insert(
        employee.skills.map((skill) => ({
          organization_id: org.id,
          employee_id: created.data.id,
          skill_id: item("skill", skill.name),
          level: skill.level,
        })),
      )
      .throwOnError();
    await admin
      .from("employee_machines")
      .insert(
        employee.machines.map((code) => {
          const machineId = machineIds.get(code);
          if (!machineId) throw new Error(`Demo machine missing: ${code}`);
          return { organization_id: org.id, employee_id: created.data.id, machine_id: machineId };
        }),
      )
      .throwOnError();
  }
}
