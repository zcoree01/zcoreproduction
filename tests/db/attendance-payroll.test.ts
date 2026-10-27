import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Attendance part C1: calculation rules (shifts.manage), premiums and hourly
// rates (payroll.manage, director / HR only; the worker reads only their
// own), holidays copied from the platform list with the non-working scope
// per key (all / selected employees), the monthly data with rates only for
// payroll.read, and tenant isolation. Rows use the DBP prefix.

const MARK = "DBP";
type Client = SupabaseClient<Database>;

let fx: Fixture;
let head: Client;
let hr: Client;
let director: Client;
const ids = { worker: "", other: "" };

async function cleanup(service: Client, orgIds: string[]) {
  const employees = await service
    .from("employees")
    .select("id")
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  const employeeIds = (employees.data ?? []).map((row) => row.id);
  if (employeeIds.length > 0) {
    await service.from("employee_hourly_rates").delete().in("employee_id", employeeIds);
    await service.from("employee_holiday_keys").delete().in("employee_id", employeeIds);
    await service.from("employee_work_info").delete().in("employee_id", employeeIds);
    await service.from("attendance_alerts").delete().in("employee_id", employeeIds);
    await service.from("attendance_sessions").delete().in("employee_id", employeeIds);
    await service.from("employees").delete().in("id", employeeIds);
  }
  await service.from("org_holiday_rules").delete().in("organization_id", orgIds);
  await service
    .from("attendance_settings")
    .update({
      overtime_mode: "daily",
      overtime_pct: 30,
      night_pct: 30,
      weekend_pct: 30,
      holiday_pct: 50,
      overtime_step_min: 15,
    })
    .in("organization_id", orgIds);
  await service
    .from("payroll_settings")
    .update({ default_hourly_rate: null })
    .in("organization_id", orgIds);
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  const org = fx.a.org;
  const password = testTenantPassword();
  await ensureUser(fx.service, org, {
    username: "sef",
    password,
    fullName: "Test Šef",
    role: "head_of_production",
  });
  await ensureUser(fx.service, org, {
    username: "kadrovska",
    password,
    fullName: "Test Kadrovska",
    role: "hr",
  });
  await ensureUser(fx.service, org, {
    username: "direktor",
    password,
    fullName: "Test Direktor",
    role: "director",
  });
  head = await signIn("sef", org.slug);
  hr = await signIn("kadrovska", org.slug);
  director = await signIn("direktor", org.slug);
  const employees = await fx.service
    .from("employees")
    .insert([
      {
        organization_id: org.id,
        employee_number: 900601,
        first_name: `${MARK} Radnik`,
        last_name: "Plata",
        user_id: fx.a.operatorId,
      },
      {
        organization_id: org.id,
        employee_number: 900602,
        first_name: `${MARK} Drugi`,
        last_name: "Plata",
      },
    ])
    .select("id, employee_number")
    .throwOnError();
  ids.worker = employees.data.find((e) => e.employee_number === 900601)!.id;
  ids.other = employees.data.find((e) => e.employee_number === 900602)!.id;
  await fx.service
    .from("attendance_sessions")
    .insert({
      organization_id: org.id,
      employee_id: ids.worker,
      work_date: "2026-11-25",
      clock_in_at: "2026-11-25T05:00:00Z",
      clock_out_at: "2026-11-25T13:00:00Z",
      clock_in_source: "mobile",
      clock_out_source: "mobile",
      idempotency_key: crypto.randomUUID(),
    })
    .throwOnError();
});

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("calculation rules and premiums", () => {
  it("lets shifts.manage change the calculation and only director / HR the premiums", async () => {
    const calc = await head
      .from("attendance_settings")
      .update({ overtime_mode: "weekly", overtime_step_min: 30 }, { count: "exact" })
      .eq("organization_id", fx.a.org.id);
    expect(calc.count).toBe(1);
    const worker = await fx.a.operator
      .from("attendance_settings")
      .update({ overtime_mode: "daily" }, { count: "exact" })
      .eq("organization_id", fx.a.org.id);
    expect(worker.count).toBe(0);
    // Premiums are not writable directly, only through save_pay_settings.
    const direct = await head
      .from("attendance_settings")
      .update({ overtime_pct: 99 })
      .eq("organization_id", fx.a.org.id);
    expect(direct.error).not.toBeNull();

    const pay = (client: Client) =>
      client.rpc("save_pay_settings", {
        p_org_id: fx.a.org.id,
        p_overtime_pct: 35,
        p_night_pct: 30,
        p_weekend_pct: 30,
        p_holiday_pct: 50,
        p_default_hourly_rate: 8.5,
      });
    expect((await pay(head)).error?.code).toBe("42501");
    expect((await pay(director)).error).toBeNull();
    const { data } = await fx.service
      .from("attendance_settings")
      .select("overtime_pct")
      .eq("organization_id", fx.a.org.id)
      .single()
      .throwOnError();
    expect(Number(data.overtime_pct)).toBe(35);
  });
});

describe("hourly rates", () => {
  it("are set and read by HR; the worker sees only their own; others see none", async () => {
    expect(
      (
        await head.rpc("set_hourly_rate", {
          p_employee_id: ids.worker,
          p_valid_from: "2026-11-01",
          p_rate: 9,
        })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await hr.rpc("set_hourly_rate", {
          p_employee_id: ids.worker,
          p_valid_from: "2026-11-01",
          p_rate: 9,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await hr.rpc("set_hourly_rate", {
          p_employee_id: ids.other,
          p_valid_from: "2026-11-01",
          p_rate: 12,
        })
      ).error,
    ).toBeNull();

    expect(
      (await hr.from("employee_hourly_rates").select("rate").eq("employee_id", ids.worker)).data,
    ).toHaveLength(1);
    expect(
      (await head.from("employee_hourly_rates").select("rate").eq("employee_id", ids.worker)).data,
    ).toEqual([]);

    const mine = await fx.a.operator.rpc("my_pay_inputs", {
      p_org_id: fx.a.org.id,
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    });
    expect(mine.error).toBeNull();
    expect(mine.data).toMatchObject({
      rates: [{ valid_from: "2026-11-01", rate: 9 }],
      default_rate: 8.5,
      weekend_days: [6, 7],
    });

    const forHead = await head.rpc("attendance_month", {
      p_org_id: fx.a.org.id,
      p_sessions_from: "2026-10-26",
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    });
    const forHr = await hr.rpc("attendance_month", {
      p_org_id: fx.a.org.id,
      p_sessions_from: "2026-10-26",
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    });
    const row = (data: unknown) =>
      (data as { employees: { id: string; rates: unknown; sessions: unknown[] }[] }).employees.find(
        (employee) => employee.id === ids.worker,
      );
    expect(row(forHead.data)?.rates).toBeNull();
    expect((forHead.data as { default_rate: unknown }).default_rate).toBeNull();
    expect(row(forHr.data)?.rates).toEqual([{ valid_from: "2026-11-01", rate: 9 }]);
    expect(row(forHr.data)?.sessions).toHaveLength(1);
  });
});

describe("holidays", () => {
  it("are copied from the platform list and are non-working only when chosen", async () => {
    const { data } = await head
      .from("org_holidays")
      .select("key, date")
      .eq("organization_id", fx.a.org.id)
      .eq("key", "statehood_day")
      .eq("date", "2026-11-25");
    expect(data).toHaveLength(1);

    const month = async () => {
      const { data: result } = await head.rpc("attendance_month", {
        p_org_id: fx.a.org.id,
        p_sessions_from: "2026-11-01",
        p_from: "2026-11-01",
        p_to: "2026-11-30",
      });
      return (result as { employees: { id: string; holidays: string[] }[] }).employees;
    };
    expect((await month()).find((row) => row.id === ids.worker)?.holidays).toEqual([]);

    expect(
      (
        await fx.a.operator.rpc("set_holiday_scope", {
          p_org_id: fx.a.org.id,
          p_key: "statehood_day",
          p_scope: "all",
        })
      ).error?.code,
    ).toBe("42501");
    await head.rpc("set_holiday_scope", {
      p_org_id: fx.a.org.id,
      p_key: "statehood_day",
      p_scope: "all",
    });
    const all = await month();
    expect(all.find((row) => row.id === ids.worker)?.holidays).toEqual(["2026-11-25"]);
    expect(all.find((row) => row.id === ids.other)?.holidays).toEqual(["2026-11-25"]);

    await head.rpc("set_holiday_scope", {
      p_org_id: fx.a.org.id,
      p_key: "statehood_day",
      p_scope: "selected",
    });
    expect(
      (
        await head.rpc("save_work_calendar", {
          p_employee_id: ids.other,
          p_weekend_days: [2, 3],
          p_holiday_keys: ["statehood_day"],
        })
      ).error,
    ).toBeNull();
    const selected = await month();
    expect(selected.find((row) => row.id === ids.worker)?.holidays).toEqual([]);
    expect(selected.find((row) => row.id === ids.other)).toMatchObject({
      holidays: ["2026-11-25"],
      weekend_days: [2, 3],
    });
  });

  it("can be imported again without duplicates", async () => {
    const again = await head.rpc("import_org_holidays", { p_org_id: fx.a.org.id, p_year: 2026 });
    expect(again.error).toBeNull();
    expect(again.data).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("keeps rates, holidays and the month inside the organization", async () => {
    expect(
      (
        await fx.b.admin
          .from("employee_hourly_rates")
          .select("id")
          .eq("organization_id", fx.a.org.id)
      ).data,
    ).toEqual([]);
    expect(
      (await fx.b.admin.from("org_holidays").select("id").eq("organization_id", fx.a.org.id)).data,
    ).toEqual([]);
    expect(
      (
        await fx.b.admin.rpc("attendance_month", {
          p_org_id: fx.a.org.id,
          p_sessions_from: "2026-11-01",
          p_from: "2026-11-01",
          p_to: "2026-11-30",
        })
      ).data,
    ).toBeNull();
    expect(
      (
        await fx.b.admin.rpc("set_hourly_rate", {
          p_employee_id: ids.worker,
          p_valid_from: "2026-11-01",
          p_rate: 1,
        })
      ).error?.code,
    ).toBe("42501");
  });
});
