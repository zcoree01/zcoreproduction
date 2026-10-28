import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Attendance part C2: kiosk activation (one-time code bound to the tenant),
// device secret checks, service-role-only device functions, badge and PIN
// clock-in / clock-out (toggle, idempotent), PIN lock after five wrong
// attempts, revoking a kiosk and tenant isolation. Rows use the DBK prefix.

const MARK = "DBK";
type Client = SupabaseClient<Database>;

let fx: Fixture;
let head: Client;
const ids = { worker: "", other: "" };
const key = () => crypto.randomUUID();

async function cleanup(service: Client, orgIds: string[]) {
  const employees = await service
    .from("employees")
    .select("id")
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  const employeeIds = (employees.data ?? []).map((row) => row.id);
  if (employeeIds.length > 0) {
    await service.from("employee_kiosk_credentials").delete().in("employee_id", employeeIds);
    await service.from("attendance_alerts").delete().in("employee_id", employeeIds);
    await service.from("attendance_sessions").delete().in("employee_id", employeeIds);
    await service.from("employees").delete().in("id", employeeIds);
  }
  await service
    .from("attendance_kiosks")
    .delete()
    .in("organization_id", orgIds)
    .like("name", `${MARK} %`);
}

async function activation(client: Client, orgId: string, name: string) {
  const { data, error } = await client
    .rpc("create_kiosk_activation", {
      p_org_id: orgId,
      p_kiosk_id: null as unknown as string,
      p_name: `${MARK} ${name}`,
    })
    .single();
  return { data, error };
}

async function activate(slug: string, code: string) {
  return fx.service.rpc("kiosk_activate", { p_org_slug: slug, p_code: code }).maybeSingle();
}

type Device = { slug: string; id: string; secret: string };

function clock(
  device: Device,
  input: { badge?: string; employee?: string; pin?: string; key?: string },
) {
  return fx.service.rpc("kiosk_clock", {
    p_org_slug: device.slug,
    p_kiosk_id: device.id,
    p_secret: device.secret,
    p_badge: (input.badge ?? null) as string,
    p_employee_id: (input.employee ?? null) as string,
    p_pin: (input.pin ?? null) as string,
    p_idempotency_key: input.key ?? key(),
  });
}

let device: Device;

/** Moves the employee's attendance a minute back (past the 10-second repeat guard). */
async function age(employeeId: string) {
  const { data } = await fx.service
    .from("attendance_sessions")
    .select("id, clock_in_at, clock_out_at")
    .eq("employee_id", employeeId)
    .order("clock_in_at")
    .throwOnError();
  const minute = (iso: string) => new Date(Date.parse(iso) - 60_000).toISOString();
  for (const row of data) {
    await fx.service
      .from("attendance_sessions")
      .update({
        clock_in_at: minute(row.clock_in_at),
        clock_out_at: row.clock_out_at ? minute(row.clock_out_at) : null,
      })
      .eq("id", row.id)
      .throwOnError();
  }
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  await ensureUser(fx.service, fx.a.org, {
    username: "sef",
    password: testTenantPassword(),
    fullName: "Test Šef",
    role: "head_of_production",
  });
  head = await signIn("sef", fx.a.org.slug);
  const employees = await fx.service
    .from("employees")
    .insert([
      {
        organization_id: fx.a.org.id,
        employee_number: 900701,
        first_name: `${MARK} Radnik`,
        last_name: "Kiosk",
        user_id: fx.a.operatorId,
      },
      {
        organization_id: fx.a.org.id,
        employee_number: 900702,
        first_name: `${MARK} Drugi`,
        last_name: "Kiosk",
      },
    ])
    .select("id, employee_number")
    .throwOnError();
  ids.worker = employees.data.find((e) => e.employee_number === 900701)!.id;
  ids.other = employees.data.find((e) => e.employee_number === 900702)!.id;
});

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("activation", () => {
  it("needs kiosk.manage, is single-use and bound to the tenant", async () => {
    expect((await activation(fx.a.operator, fx.a.org.id, "Zabranjen")).error?.code).toBe("42501");
    const created = await activation(head, fx.a.org.id, "Ulaz");
    expect(created.error).toBeNull();
    const code = created.data!.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    expect((await activate(fx.b.org.slug, code)).error?.message).toBe("invalid_code");
    const first = await activate(fx.a.org.slug, code.toLowerCase());
    expect(first.error).toBeNull();
    expect(first.data?.secret).toMatch(/^[a-f0-9]{64}$/);
    expect((await activate(fx.a.org.slug, code)).error?.message).toBe("invalid_code");
    device = { slug: fx.a.org.slug, id: first.data!.kiosk_id, secret: first.data!.secret };

    // The device functions are not callable by signed-in users.
    const direct = await fx.a.admin.rpc("kiosk_activate", {
      p_org_slug: fx.a.org.slug,
      p_code: code,
    });
    expect(direct.error).not.toBeNull();
  });

  it("refuses an unknown secret or another tenant's host", async () => {
    const wrong = await fx.service.rpc("kiosk_session", {
      p_org_slug: device.slug,
      p_kiosk_id: device.id,
      p_secret: "0".repeat(64),
    });
    expect(wrong.error?.message).toBe("kiosk_unknown");
    const foreign = await fx.service.rpc("kiosk_session", {
      p_org_slug: fx.b.org.slug,
      p_kiosk_id: device.id,
      p_secret: device.secret,
    });
    expect(foreign.error?.message).toBe("kiosk_unknown");
    const ok = await fx.service.rpc("kiosk_session", {
      p_org_slug: device.slug,
      p_kiosk_id: device.id,
      p_secret: device.secret,
    });
    expect(ok.error).toBeNull();
    expect(
      (ok.data as { employees: { id: string }[] }).employees.some(
        (employee) => employee.id === ids.worker,
      ),
    ).toBe(true);
  });
});

describe("clocking on the kiosk", () => {
  it("toggles clock-in / clock-out with a badge, idempotently", async () => {
    expect((await head.rpc("issue_badge", { p_employee_id: ids.worker })).error).toBeNull();
    const { data: credential } = await fx.service
      .from("employee_kiosk_credentials")
      .select("badge_token")
      .eq("employee_id", ids.worker)
      .single()
      .throwOnError();
    const badge = credential.badge_token!;

    const scan = key();
    const first = await clock(device, { badge, key: scan });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ direction: "in", employee_name: `${MARK} Radnik Kiosk` });
    expect((await clock(device, { badge, key: scan })).data).toMatchObject({ direction: "in" });
    // The card read again right away (held at the reader): nothing changes.
    expect((await clock(device, { badge })).data).toMatchObject({ direction: "in", repeat: true });
    await age(ids.worker);
    const out = await clock(device, { badge });
    expect(out.data).toMatchObject({ direction: "out", repeat: false });

    const { data: sessions } = await fx.service
      .from("attendance_sessions")
      .select("clock_in_source, clock_out_source")
      .eq("employee_id", ids.worker)
      .throwOnError();
    expect(sessions).toEqual([{ clock_in_source: "kiosk", clock_out_source: "kiosk" }]);

    expect((await clock(device, { badge: "f".repeat(24) })).error?.message).toBe("badge_unknown");
  });

  it("checks the PIN and locks it after five wrong attempts", async () => {
    expect(
      (await fx.a.operator.rpc("set_own_pin", { p_org_id: fx.a.org.id, p_pin: "48a1" })).error
        ?.code,
    ).toBe("22023");
    expect(
      (await fx.a.operator.rpc("set_own_pin", { p_org_id: fx.a.org.id, p_pin: "4821" })).error,
    ).toBeNull();
    await age(ids.worker);
    const ok = await clock(device, { employee: ids.worker, pin: "4821" });
    expect(ok.data).toMatchObject({ direction: "in" });
    await clock(device, { employee: ids.worker, pin: "4821" });

    expect(
      (await head.rpc("set_employee_pin", { p_employee_id: ids.other, p_pin: "7305" })).error,
    ).toBeNull();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await clock(device, { employee: ids.other, pin: "0000" })).data).toEqual({
        error: "pin_wrong",
      });
    }
    expect((await clock(device, { employee: ids.other, pin: "0000" })).data).toEqual({
      error: "pin_locked",
    });
    expect((await clock(device, { employee: ids.other, pin: "7305" })).error?.message).toBe(
      "pin_locked",
    );
    expect((await clock(device, { employee: ids.worker })).error).toBeNull();
  });
});

describe("revoking and tenant isolation", () => {
  it("keeps other tenants out and stops a revoked kiosk", async () => {
    expect((await fx.b.admin.rpc("issue_badge", { p_employee_id: ids.worker })).error?.code).toBe(
      "42501",
    );
    const listed = await fx.b.admin.rpc("kiosk_credentials", { p_org_id: fx.a.org.id });
    expect(listed.data).toEqual([]);
    expect(
      (await fx.a.operator.from("employee_kiosk_credentials").select("pin_hash")).data ?? [],
    ).toEqual([]);

    expect((await head.rpc("revoke_kiosk", { p_kiosk_id: device.id })).error).toBeNull();
    const after = await fx.service.rpc("kiosk_session", {
      p_org_slug: device.slug,
      p_kiosk_id: device.id,
      p_secret: device.secret,
    });
    expect(after.error?.message).toBe("kiosk_unknown");
  });
});
