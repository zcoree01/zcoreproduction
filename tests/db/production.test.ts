import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { setupFixture, type Fixture, type Tenant } from "./fixtures";

// Machines, employees and catalogs: tenant isolation, permission rules,
// set_machine_status / save_employee behaviour. Rows created here are marked
// (DBT prefix / first name) and removed before and after the run.

const MARK = "DBT";
const EMPLOYEE_MARK = "DBTest";

function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient;
}

type TenantData = {
  machineTypeId: string;
  skillId: string;
  machineId: string;
  otherMachineId: string;
  employeeId: string;
};

let fx: Fixture;
const data: Record<"a" | "b", TenantData> = {} as Record<"a" | "b", TenantData>;

async function cleanup(service: SupabaseClient<Database>, orgIds: string[]) {
  const employees = await service
    .from("employees")
    .select("id")
    .in("organization_id", orgIds)
    .like("first_name", `${EMPLOYEE_MARK}%`);
  const employeeIds = (employees.data ?? []).map((row) => row.id);
  if (employeeIds.length > 0) {
    await service.from("employee_skills").delete().in("employee_id", employeeIds);
    await service.from("employee_machines").delete().in("employee_id", employeeIds);
    await service.from("employees").delete().in("id", employeeIds);
  }
  const machines = await service
    .from("machines")
    .select("id")
    .in("organization_id", orgIds)
    .like("code", `${MARK}-%`);
  const machineIds = (machines.data ?? []).map((row) => row.id);
  if (machineIds.length > 0) {
    await service.from("employee_machines").delete().in("machine_id", machineIds);
    await service.from("machines").delete().in("id", machineIds);
  }
  await service
    .from("catalog_items")
    .delete()
    .in("organization_id", orgIds)
    .like("name", `${MARK} %`);
}

async function seedTenant(service: SupabaseClient<Database>, tenant: Tenant): Promise<TenantData> {
  const org = tenant.org.id;
  const items = await service
    .from("catalog_items")
    .insert([
      { organization_id: org, kind: "machine_type", name: `${MARK} Glodalica` },
      { organization_id: org, kind: "skill", name: `${MARK} Programiranje` },
    ])
    .select("id, kind")
    .throwOnError();
  const machineTypeId = items.data.find((i) => i.kind === "machine_type")!.id;
  const skillId = items.data.find((i) => i.kind === "skill")!.id;

  const machines = await service
    .from("machines")
    .insert([
      { organization_id: org, code: `${MARK}-01`, name: "Assigned", type_id: machineTypeId },
      { organization_id: org, code: `${MARK}-02`, name: "Not assigned" },
    ])
    .select("id, code")
    .throwOnError();
  const machineId = machines.data.find((m) => m.code === `${MARK}-01`)!.id;
  const otherMachineId = machines.data.find((m) => m.code === `${MARK}-02`)!.id;

  // The operator account is linked to an employee qualified for machine 01.
  const employee = await service
    .from("employees")
    .insert({
      organization_id: org,
      employee_number: 900001,
      first_name: EMPLOYEE_MARK,
      last_name: "Operater",
      user_id: tenant.operatorId,
    })
    .select("id")
    .single()
    .throwOnError();
  await service
    .from("employee_machines")
    .insert({ organization_id: org, employee_id: employee.data.id, machine_id: machineId })
    .throwOnError();

  return { machineTypeId, skillId, machineId, otherMachineId, employeeId: employee.data.id };
}

beforeAll(async () => {
  fx = await setupFixture();
  const orgIds = [fx.a.org.id, fx.b.org.id];
  await cleanup(fx.service, orgIds);
  data.a = await seedTenant(fx.service, fx.a);
  data.b = await seedTenant(fx.service, fx.b);
});

afterAll(async () => {
  if (fx) await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

const TABLES = [
  "catalog_items",
  "machines",
  "employees",
  "employee_machines",
  "machine_directory",
  "employee_directory",
] as const;

describe("production tables: tenant isolation", () => {
  it.each(TABLES)("admin A sees only tenant A rows in %s", async (table) => {
    const { data: rows, error } = await untyped(fx.a.admin).from(table).select("organization_id");
    expect(error).toBeNull();
    expect(rows?.length).toBeGreaterThan(0);
    expect(new Set(rows?.map((row: { organization_id: string }) => row.organization_id))).toEqual(
      new Set([fx.a.org.id]),
    );
  });

  it("admin A cannot create a machine in tenant B", async () => {
    const { error } = await fx.a.admin
      .from("machines")
      .insert({ organization_id: fx.b.org.id, code: `${MARK}-X`, name: "Intruder" });
    expect(error?.code).toBe("42501");
  });

  it("admin A cannot update tenant B's machine", async () => {
    const { data: rows } = await fx.a.admin
      .from("machines")
      .update({ name: "hacked" })
      .eq("id", data.b.machineId)
      .select("id");
    expect(rows).toEqual([]);
  });

  it("a machine cannot reference a catalog item of another tenant", async () => {
    const { error } = await fx.a.admin.from("machines").insert({
      organization_id: fx.a.org.id,
      code: `${MARK}-03`,
      name: "Cross-tenant type",
      type_id: data.b.machineTypeId,
    });
    expect(error?.code).toBe("23503");
  });

  it("a machine type must be a machine_type item (kind is part of the FK)", async () => {
    const { error } = await fx.a.admin.from("machines").insert({
      organization_id: fx.a.org.id,
      code: `${MARK}-04`,
      name: "Skill as type",
      type_id: data.a.skillId,
    });
    expect(error?.code).toBe("23503");
  });

  it("set_machine_status does not reveal machines of another tenant", async () => {
    const { error } = await fx.a.admin.rpc("set_machine_status", {
      p_machine_id: data.b.machineId,
      p_status: "stopped",
    });
    expect(error?.code).toBe("P0002");
  });
});

describe("operator access", () => {
  it("reads machines but cannot create or edit them", async () => {
    const read = await fx.a.operator.from("machines").select("id").eq("id", data.a.machineId);
    expect(read.data?.length).toBe(1);

    const insert = await fx.a.operator
      .from("machines")
      .insert({ organization_id: fx.a.org.id, code: `${MARK}-05`, name: "Nope" });
    expect(insert.error?.code).toBe("42501");

    const update = await fx.a.operator
      .from("machines")
      .update({ name: "Renamed" })
      .eq("id", data.a.machineId)
      .select("id");
    expect(update.data).toEqual([]);
  });

  it("sees only their own employee row and machine assignments", async () => {
    await fx.service
      .from("employees")
      .insert({
        organization_id: fx.a.org.id,
        employee_number: 900002,
        first_name: `${EMPLOYEE_MARK} Other`,
        last_name: "Colleague",
      })
      .throwOnError();

    const employees = await fx.a.operator.from("employees").select("id");
    expect(employees.data?.map((row) => row.id)).toEqual([data.a.employeeId]);

    const assignments = await fx.a.operator.from("employee_machines").select("machine_id");
    expect(assignments.data?.map((row) => row.machine_id)).toEqual([data.a.machineId]);
  });

  it("cannot save employees", async () => {
    const { error } = await fx.a.operator.rpc("save_employee", {
      p_org_id: fx.a.org.id,
      p_first_name: EMPLOYEE_MARK,
      p_last_name: "Self-made",
      p_status: "active",
      p_skills: [],
      p_machine_ids: [],
    });
    expect(error?.code).toBe("42501");
  });
});

describe("set_machine_status", () => {
  it("lets an operator change the status of a machine they are qualified for", async () => {
    const { error } = await fx.a.operator.rpc("set_machine_status", {
      p_machine_id: data.a.machineId,
      p_status: "running",
    });
    expect(error).toBeNull();

    const row = await fx.service
      .from("machines")
      .select("status, status_changed_by")
      .eq("id", data.a.machineId)
      .single();
    expect(row.data).toEqual({ status: "running", status_changed_by: fx.a.operatorId });
  });

  it("records status changes in the audit log", async () => {
    const audit = await fx.a.admin
      .from("audit_log")
      .select("action, actor_id, after")
      .eq("entity_type", "machines")
      .eq("entity_id", data.a.machineId)
      .eq("action", "machines.update")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    expect(audit.data?.actor_id).toBe(fx.a.operatorId);
    expect((audit.data?.after as { status: string }).status).toBe("running");
  });

  it("refuses machines the operator is not qualified for", async () => {
    const { error } = await fx.a.operator.rpc("set_machine_status", {
      p_machine_id: data.a.otherMachineId,
      p_status: "running",
    });
    expect(error?.code).toBe("42501");
  });

  it("never lets an operator set or leave 'inactive'", async () => {
    const toInactive = await fx.a.operator.rpc("set_machine_status", {
      p_machine_id: data.a.machineId,
      p_status: "inactive",
    });
    expect(toInactive.error?.code).toBe("42501");

    const byAdmin = await fx.a.admin.rpc("set_machine_status", {
      p_machine_id: data.a.machineId,
      p_status: "inactive",
    });
    expect(byAdmin.error).toBeNull();

    const fromInactive = await fx.a.operator.rpc("set_machine_status", {
      p_machine_id: data.a.machineId,
      p_status: "available",
    });
    expect(fromInactive.error?.code).toBe("42501");

    await fx.a.admin
      .rpc("set_machine_status", { p_machine_id: data.a.machineId, p_status: "available" })
      .throwOnError();
  });

  it("stops working once the operator's employee is inactive", async () => {
    await fx.service
      .from("employees")
      .update({ status: "inactive" })
      .eq("id", data.a.employeeId)
      .throwOnError();
    const { error } = await fx.a.operator.rpc("set_machine_status", {
      p_machine_id: data.a.machineId,
      p_status: "stopped",
    });
    expect(error?.code).toBe("42501");
    await fx.service
      .from("employees")
      .update({ status: "active" })
      .eq("id", data.a.employeeId)
      .throwOnError();
  });

  it("rejects unknown statuses", async () => {
    const { error } = await fx.a.admin.rpc("set_machine_status", {
      p_machine_id: data.a.machineId,
      p_status: "exploded",
    });
    expect(error?.code).toBe("22023");
  });
});

describe("save_employee", () => {
  it("assigns the next employee number and stores skills and machines", async () => {
    const { data: id, error } = await fx.a.admin.rpc("save_employee", {
      p_org_id: fx.a.org.id,
      p_first_name: ` ${EMPLOYEE_MARK} `,
      p_last_name: "Novi",
      p_status: "active",
      p_skills: [{ skill_id: data.a.skillId, level: 2 }],
      p_machine_ids: [data.a.machineId, data.a.otherMachineId],
    });
    expect(error).toBeNull();

    const max = await fx.service
      .from("employees")
      .select("employee_number")
      .eq("organization_id", fx.a.org.id)
      .neq("id", id!)
      .order("employee_number", { ascending: false })
      .limit(1)
      .single();
    const saved = await fx.service
      .from("employee_directory")
      .select("employee_number, first_name, skills, machines")
      .eq("id", id!)
      .single();
    expect(saved.data?.employee_number).toBe((max.data?.employee_number ?? 0) + 1);
    expect(saved.data?.first_name).toBe(EMPLOYEE_MARK);
    expect(saved.data?.skills).toEqual([
      { skill_id: data.a.skillId, name: `${MARK} Programiranje`, level: 2 },
    ]);
    expect((saved.data?.machines as unknown[]).length).toBe(2);

    // Update replaces the lists: one machine removed, skill level changed.
    await fx.a.admin
      .rpc("save_employee", {
        p_org_id: fx.a.org.id,
        p_employee_id: id!,
        p_first_name: EMPLOYEE_MARK,
        p_last_name: "Novi",
        p_status: "inactive",
        p_skills: [{ skill_id: data.a.skillId, level: 3 }],
        p_machine_ids: [data.a.otherMachineId],
      })
      .throwOnError();
    const updated = await fx.service
      .from("employee_directory")
      .select("employee_number, status, skills, machines")
      .eq("id", id!)
      .single();
    expect(updated.data?.employee_number).toBe(saved.data?.employee_number);
    expect(updated.data?.status).toBe("inactive");
    expect(updated.data?.skills).toEqual([
      { skill_id: data.a.skillId, name: `${MARK} Programiranje`, level: 3 },
    ]);
    expect(updated.data?.machines).toEqual([
      { machine_id: data.a.otherMachineId, code: `${MARK}-02`, name: "Not assigned" },
    ]);
  });

  it("rejects a duplicate employee number", async () => {
    const { error } = await fx.a.admin.rpc("save_employee", {
      p_org_id: fx.a.org.id,
      p_employee_number: 900001,
      p_first_name: EMPLOYEE_MARK,
      p_last_name: "Duplicate",
      p_status: "active",
      p_skills: [],
      p_machine_ids: [],
    });
    expect(error?.code).toBe("23505");
    expect(error?.message).toContain("employees_organization_id_employee_number_key");
  });

  it("links an account to at most one current employee", async () => {
    const { error } = await fx.a.admin.rpc("save_employee", {
      p_org_id: fx.a.org.id,
      p_first_name: EMPLOYEE_MARK,
      p_last_name: "Second link",
      p_user_id: fx.a.operatorId,
      p_status: "active",
      p_skills: [],
      p_machine_ids: [],
    });
    expect(error?.code).toBe("23505");
    expect(error?.message).toContain("employees_user_key");
  });

  it("is atomic: a foreign machine rolls back the whole save", async () => {
    const { error } = await fx.a.admin.rpc("save_employee", {
      p_org_id: fx.a.org.id,
      p_first_name: EMPLOYEE_MARK,
      p_last_name: "Rolled back",
      p_status: "active",
      p_skills: [{ skill_id: data.a.skillId, level: 1 }],
      p_machine_ids: [data.b.machineId],
    });
    expect(error?.code).toBe("23503");

    const leftovers = await fx.service
      .from("employees")
      .select("id")
      .eq("organization_id", fx.a.org.id)
      .eq("last_name", "Rolled back");
    expect(leftovers.data).toEqual([]);
  });

  it("admin A cannot save employees into tenant B", async () => {
    const { error } = await fx.a.admin.rpc("save_employee", {
      p_org_id: fx.b.org.id,
      p_first_name: EMPLOYEE_MARK,
      p_last_name: "Intruder",
      p_status: "active",
      p_skills: [],
      p_machine_ids: [],
    });
    expect(error?.code).toBe("42501");
  });
});

describe("catalog_items", () => {
  it("rejects a second active item with the same name (case-insensitive)", async () => {
    const { error } = await fx.a.admin
      .from("catalog_items")
      .insert({ organization_id: fx.a.org.id, kind: "skill", name: `${MARK} programiranje ` });
    expect(error?.code).toBe("23505");
  });

  it("operators cannot manage catalogs", async () => {
    const { error } = await fx.a.operator
      .from("catalog_items")
      .insert({ organization_id: fx.a.org.id, kind: "skill", name: `${MARK} Operator` });
    expect(error?.code).toBe("42501");
  });

  it("archived names can be reused", async () => {
    await fx.a.admin
      .from("catalog_items")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.a.skillId)
      .throwOnError();
    const { error } = await fx.a.admin
      .from("catalog_items")
      .insert({ organization_id: fx.a.org.id, kind: "skill", name: `${MARK} Programiranje` });
    expect(error).toBeNull();
  });
});
