import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/types";
import { zonedLocalToUtc } from "@/lib/timezone";
import { setupFixture, type Fixture } from "./fixtures";

// Attendance (part A): shift definitions, shift recognition (night shift,
// DST night, schedule), clock-in / clock-out rules (no double clock-in, no
// clock-out without clock-in, no overlap, idempotency), forgotten clock-out
// closed at the shift's end with an alert, work on operations needing a
// clock-in (block / automatic clock-in), one attendance session for a worker
// on two machines, RLS and tenant isolation. Rows use the DBA prefix.

const MARK = "DBA";
const TZ = "Europe/Sarajevo";
type Client = SupabaseClient<Database>;

let fx: Fixture;
const ids = {
  operatorEmployee: "",
  otherEmployee: "",
  first: "",
  second: "",
  night: "",
  turnType: "",
  m1: "",
  m2: "",
  customer: "",
  p1: "",
  p2: "",
};

const at = (local: string) => zonedLocalToUtc(local, TZ);
const key = () => crypto.randomUUID();

async function cleanup(service: Client, orgIds: string[]) {
  const orders = await service
    .from("production_orders")
    .select("id")
    .in("organization_id", orgIds)
    .like("notes", `${MARK}%`);
  const orderIds = (orders.data ?? []).map((row) => row.id);
  if (orderIds.length > 0) {
    await service.from("production_reports").delete().in("order_id", orderIds);
    await service.from("production_work_sessions").delete().in("order_id", orderIds);
    await service.from("production_downtime_events").delete().in("order_id", orderIds);
    await service.from("production_order_status_history").delete().in("order_id", orderIds);
    await service.from("production_order_attachments").delete().in("order_id", orderIds);
    await service.from("production_order_operations").delete().in("order_id", orderIds);
    await service.from("production_orders").delete().in("id", orderIds);
  }
  const products = await service
    .from("products")
    .select("id")
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
      await service.from("product_operations").delete().in("revision_id", revisionIds);
      await service.from("product_revisions").delete().in("id", revisionIds);
    }
    await service.from("products").delete().in("id", productIds);
  }

  const employees = await service
    .from("employees")
    .select("id")
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  const employeeIds = (employees.data ?? []).map((row) => row.id);
  if (employeeIds.length > 0) {
    await service.from("attendance_alerts").delete().in("employee_id", employeeIds);
    await service.from("attendance_sessions").delete().in("employee_id", employeeIds);
    await service.from("shift_schedule").delete().in("employee_id", employeeIds);
    await service.from("employee_machines").delete().in("employee_id", employeeIds);
    await service.from("employees").delete().in("id", employeeIds);
  }
  await service.from("shifts").delete().in("organization_id", orgIds).like("name", `${MARK} %`);
  await service.from("machines").delete().in("organization_id", orgIds).like("code", `${MARK}-%`);
  await service
    .from("operation_types")
    .delete()
    .in("organization_id", orgIds)
    .like("code", `${MARK}%`);
  await service.from("customers").delete().in("organization_id", orgIds).like("name", `${MARK} %`);
  await service
    .from("attendance_settings")
    .update({ operation_without_clock_in: "auto_clock_in", auto_close_after_hours: 22 })
    .in("organization_id", orgIds);
}

async function saveShift(
  client: Client,
  name: string,
  code: string,
  startsAt: string,
  endsAt: string,
  breaks: { starts_at: string | null; minutes: number; paid: boolean }[] = [],
) {
  return client.rpc("save_shift", {
    p_org_id: fx.a.org.id,
    p_id: null as unknown as string,
    p_name: `${MARK} ${name}`,
    p_code: code,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_color: "",
    p_breaks: breaks as Json,
  });
}

async function productWithTurning(partNumber: string, machineId: string) {
  const product = await fx.a.admin.rpc("create_product", {
    p_org_id: fx.a.org.id,
    p_product: {
      part_number: partNumber,
      name: "Osovina",
      customer_id: ids.customer,
      unit: "pcs",
      inspection_plan: "none",
    },
    p_revision: { revision: "A" },
  });
  expect(product.error).toBeNull();
  const revision = await fx.service
    .from("product_revisions")
    .select("id")
    .eq("product_id", product.data!)
    .single()
    .throwOnError();
  const saved = await fx.a.admin.rpc("save_product_operation", {
    p_revision_id: revision.data.id,
    p_operation_id: null as unknown as string,
    p_operation: { operation_type_id: ids.turnType, machine_id: machineId, cycle_time_s: "60" },
  });
  expect(saved.error).toBeNull();
  return product.data!;
}

async function readyOperation(productId: string): Promise<string> {
  const order = await fx.a.admin.rpc("create_production_order", {
    p_org_id: fx.a.org.id,
    p_order: {
      customer_id: ids.customer,
      product_id: productId,
      quantity: "5",
      due_date: "2030-06-30",
      notes: `${MARK} order`,
    } as Json,
  });
  expect(order.error).toBeNull();
  for (const status of ["planned", "ready"]) {
    const set = await fx.a.admin.rpc("set_production_order_status", {
      p_order_id: order.data!,
      p_status: status,
    });
    expect(set.error).toBeNull();
  }
  const op = await fx.service
    .from("production_order_operations")
    .select("id")
    .eq("order_id", order.data!)
    .eq("operation_type_id", ids.turnType)
    .single()
    .throwOnError();
  return op.data.id;
}

async function openSessions(employeeId: string) {
  const { data } = await fx.service
    .from("attendance_sessions")
    .select("id, clock_in_source, shift_id")
    .eq("employee_id", employeeId)
    .is("clock_out_at", null)
    .is("archived_at", null)
    .throwOnError();
  return data;
}

async function clockOutIfOpen() {
  if ((await openSessions(ids.operatorEmployee)).length > 0) {
    const out = await fx.a.operator.rpc("clock_out", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: key(),
    });
    expect(out.error).toBeNull();
  }
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  const org = fx.a.org.id;
  const s = fx.service;

  const employees = await s
    .from("employees")
    .insert([
      {
        organization_id: org,
        employee_number: 900301,
        first_name: `${MARK} Radnik`,
        last_name: "Prisustvo",
        user_id: fx.a.operatorId,
      },
      {
        organization_id: org,
        employee_number: 900302,
        first_name: `${MARK} Drugi`,
        last_name: "Bez računa",
      },
    ])
    .select("id, employee_number")
    .throwOnError();
  ids.operatorEmployee = employees.data.find((e) => e.employee_number === 900301)!.id;
  ids.otherEmployee = employees.data.find((e) => e.employee_number === 900302)!.id;

  const first = await saveShift(fx.a.admin, "Prva", "DI", "06:00", "14:00", [
    { starts_at: "10:00", minutes: 30, paid: false },
  ]);
  const second = await saveShift(fx.a.admin, "Druga", "DII", "14:00", "22:00");
  const night = await saveShift(fx.a.admin, "Noćna", "DIII", "22:00", "06:00", [
    { starts_at: null, minutes: 30, paid: false },
  ]);
  expect(first.error).toBeNull();
  expect(second.error).toBeNull();
  expect(night.error).toBeNull();
  ids.first = first.data!;
  ids.second = second.data!;
  ids.night = night.data!;

  const type = await s
    .from("operation_types")
    .insert({ organization_id: org, code: `${MARK}TO`, name: `${MARK} Tokarenje` })
    .select("id")
    .single()
    .throwOnError();
  ids.turnType = type.data.id;
  const machines = await s
    .from("machines")
    .insert([
      { organization_id: org, code: `${MARK}-M1`, name: "CNC 1" },
      { organization_id: org, code: `${MARK}-M2`, name: "CNC 2" },
    ])
    .select("id, code")
    .throwOnError();
  ids.m1 = machines.data.find((m) => m.code === `${MARK}-M1`)!.id;
  ids.m2 = machines.data.find((m) => m.code === `${MARK}-M2`)!.id;
  await s
    .from("employee_machines")
    .insert([
      { organization_id: org, employee_id: ids.operatorEmployee, machine_id: ids.m1 },
      { organization_id: org, employee_id: ids.operatorEmployee, machine_id: ids.m2 },
    ])
    .throwOnError();
  const customer = await s
    .from("customers")
    .insert({ organization_id: org, name: `${MARK} Kupac` })
    .select("id")
    .single()
    .throwOnError();
  ids.customer = customer.data.id;
  ids.p1 = await productWithTurning(`${MARK}-1`, ids.m1);
  ids.p2 = await productWithTurning(`${MARK}-2`, ids.m2);
});

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("shift definitions", () => {
  it("are managed with shifts.manage and validated like the form", async () => {
    const denied = await saveShift(fx.a.operator, "Zabranjena", "DX", "06:00", "14:00");
    expect(denied.error?.code).toBe("42501");
    const tooLong = await saveShift(fx.a.admin, "Duga pauza", "DX", "06:00", "07:00", [
      { starts_at: null, minutes: 60, paid: false },
    ]);
    expect(tooLong.error?.message).toBe("breaks_too_long");
    const outside = await saveShift(fx.a.admin, "Van smjene", "DX", "22:00", "06:00", [
      { starts_at: "05:45", minutes: 30, paid: false },
    ]);
    expect(outside.error?.message).toBe("break_outside_shift");

    const { data } = await fx.a.operator
      .from("shift_breaks")
      .select("starts_at, duration_min, paid")
      .eq("shift_id", ids.first)
      .throwOnError();
    expect(data).toEqual([{ starts_at: "10:00:00", duration_min: 30, paid: false }]);
  });
});

describe("shift recognition", () => {
  async function recognise(local: string) {
    const { data, error } = await fx.a.admin.rpc("attendance_shift_for", {
      p_employee_id: ids.operatorEmployee,
      p_at: at(local),
    });
    expect(error).toBeNull();
    return data?.[0] ?? null;
  }

  it("picks the closest shift start, early arrivals included", async () => {
    const early = await recognise("2026-10-20T05:30");
    expect(early?.shift_id).toBe(ids.first);
    expect(early?.work_date).toBe("2026-10-20");
    expect(Date.parse(early!.scheduled_start)).toBe(Date.parse(at("2026-10-20T06:00")));
    expect(early?.breaks).toEqual([{ starts_at: expect.any(String), minutes: 30, paid: false }]);
    const breaks = early!.breaks as { starts_at: string }[];
    expect(Date.parse(breaks[0]!.starts_at)).toBe(Date.parse(at("2026-10-20T10:00")));

    expect((await recognise("2026-10-20T13:50"))?.shift_id).toBe(ids.second);
    expect((await recognise("2026-10-20T09:00"))?.shift_id).toBe(ids.first);
  });

  it("puts a night shift on the day it starts, also after midnight", async () => {
    const night = await recognise("2026-10-20T21:55");
    expect(night?.shift_id).toBe(ids.night);
    expect(night?.work_date).toBe("2026-10-20");
    const afterMidnight = await recognise("2026-10-21T01:00");
    expect(afterMidnight?.shift_id).toBe(ids.night);
    expect(afterMidnight?.work_date).toBe("2026-10-20");
  });

  it("gives the night of the DST change its real nine hours", async () => {
    const night = await recognise("2026-10-24T22:00");
    expect(night?.work_date).toBe("2026-10-24");
    const hours =
      (Date.parse(night!.scheduled_end) - Date.parse(night!.scheduled_start)) / 3_600_000;
    expect(hours).toBe(9);
  });

  it("uses only scheduled shifts when the schedule has entries", async () => {
    await fx.service
      .from("shift_schedule")
      .insert({
        organization_id: fx.a.org.id,
        employee_id: ids.operatorEmployee,
        work_date: "2026-11-03",
        shift_id: ids.second,
      })
      .throwOnError();
    expect(await recognise("2026-11-03T05:50")).toBeNull();
    expect((await recognise("2026-11-03T13:30"))?.shift_id).toBe(ids.second);
  });

  it("is not readable for other employees or another tenant", async () => {
    const own = await fx.a.operator.rpc("attendance_shift_for", {
      p_employee_id: ids.operatorEmployee,
      p_at: at("2026-10-20T05:30"),
    });
    expect(own.data).toHaveLength(1);
    const other = await fx.a.operator.rpc("attendance_shift_for", {
      p_employee_id: ids.otherEmployee,
      p_at: at("2026-10-20T05:30"),
    });
    expect(other.data).toEqual([]);
    const foreign = await fx.b.admin.rpc("attendance_shift_for", {
      p_employee_id: ids.operatorEmployee,
      p_at: at("2026-10-20T05:30"),
    });
    expect(foreign.data).toEqual([]);
  });
});

describe("clock-in and clock-out", () => {
  it("refuses a double clock-in and a clock-out without clock-in; resends are idempotent", async () => {
    await clockOutIfOpen();
    const org = fx.a.org.id;
    const inKey = key();
    const first = await fx.a.operator.rpc("clock_in", { p_org_id: org, p_idempotency_key: inKey });
    expect(first.error).toBeNull();
    const resend = await fx.a.operator.rpc("clock_in", { p_org_id: org, p_idempotency_key: inKey });
    expect(resend.data).toBe(first.data);
    const twice = await fx.a.operator.rpc("clock_in", { p_org_id: org, p_idempotency_key: key() });
    expect(twice.error?.message).toBe("already_clocked_in");

    const outKey = key();
    const out = await fx.a.operator.rpc("clock_out", { p_org_id: org, p_idempotency_key: outKey });
    expect(out.error).toBeNull();
    expect(out.data).toBe(first.data);
    const outResend = await fx.a.operator.rpc("clock_out", {
      p_org_id: org,
      p_idempotency_key: outKey,
    });
    expect(outResend.data).toBe(first.data);
    const outAgain = await fx.a.operator.rpc("clock_out", {
      p_org_id: org,
      p_idempotency_key: key(),
    });
    expect(outAgain.error?.message).toBe("not_clocked_in");

    const { data } = await fx.service
      .from("attendance_sessions")
      .select("clock_in_source, clock_out_source, clock_in_at, clock_out_at")
      .eq("id", first.data!)
      .single()
      .throwOnError();
    expect(data).toMatchObject({ clock_in_source: "mobile", clock_out_source: "mobile" });
  });

  it("never stores overlapping sessions of one employee", async () => {
    const insert = (from: string, to: string | null) =>
      fx.service.from("attendance_sessions").insert({
        organization_id: fx.a.org.id,
        employee_id: ids.otherEmployee,
        work_date: "2026-09-01",
        clock_in_at: at(from),
        clock_out_at: to ? at(to) : null,
        clock_in_source: "manual",
        clock_out_source: to ? "manual" : null,
        idempotency_key: key(),
      });
    expect((await insert("2026-09-01T06:00", "2026-09-01T14:00")).error).toBeNull();
    expect((await insert("2026-09-01T13:00", "2026-09-01T15:00")).error?.code).toBe("23P01");
    expect((await insert("2026-09-01T14:00", "2026-09-01T15:00")).error).toBeNull();
  });

  it("refuses members without an employee and other tenants", async () => {
    const b = await fx.b.operator.rpc("clock_in", {
      p_org_id: fx.b.org.id,
      p_idempotency_key: key(),
    });
    expect(b.error?.message).toBe("not_an_employee");
    const cross = await fx.b.operator.rpc("clock_in", {
      p_org_id: fx.a.org.id,
      p_idempotency_key: key(),
    });
    expect(cross.error?.message).toBe("not_an_employee");
  });

  it("lets a worker read only their own attendance; writes go through the functions", async () => {
    const own = await fx.a.operator
      .from("attendance_sessions")
      .select("employee_id")
      .eq("organization_id", fx.a.org.id);
    expect(own.data?.length).toBeGreaterThan(0);
    expect(own.data?.every((row) => row.employee_id === ids.operatorEmployee)).toBe(true);

    const update = await fx.a.operator
      .from("attendance_sessions")
      .update({ clock_out_at: new Date().toISOString() })
      .eq("employee_id", ids.operatorEmployee);
    expect(update.error).not.toBeNull();

    const foreign = await fx.b.admin
      .from("attendance_sessions")
      .select("id")
      .eq("organization_id", fx.a.org.id);
    expect(foreign.data).toEqual([]);
    expect(
      (await fx.b.admin.rpc("attendance_board", { p_org_id: fx.a.org.id, p_date: "2026-09-01" }))
        .data,
    ).toBeNull();
    expect(
      (await fx.a.operator.rpc("attendance_board", { p_org_id: fx.a.org.id, p_date: "2026-09-01" }))
        .data,
    ).toBeNull();
  });
});

describe("forgotten clock-out", () => {
  it("closes the session at the shift's end after the limit and alerts the foreman", async () => {
    const clockIn = new Date(Date.now() - 23 * 3_600_000);
    const scheduledEnd = new Date(clockIn.getTime() + 8 * 3_600_000);
    const inserted = await fx.service
      .from("attendance_sessions")
      .insert({
        organization_id: fx.a.org.id,
        employee_id: ids.otherEmployee,
        shift_id: ids.first,
        work_date: "2026-10-25",
        scheduled_start: clockIn.toISOString(),
        scheduled_end: scheduledEnd.toISOString(),
        clock_in_at: clockIn.toISOString(),
        clock_in_source: "mobile",
        idempotency_key: key(),
      })
      .select("id")
      .single()
      .throwOnError();

    // Any attendance read closes overdue sessions (no scheduler needed).
    const alerts = await fx.a.admin.rpc("pending_attendance_alerts", { p_org_id: fx.a.org.id });
    expect(alerts.error).toBeNull();
    const alert = alerts.data?.find((row) => row.session_id === inserted.data.id);
    expect(alert?.kind).toBe("auto_clock_out");
    expect(Date.parse(alert!.clock_out_at!)).toBe(scheduledEnd.getTime());

    const { data } = await fx.service
      .from("attendance_sessions")
      .select("clock_out_source")
      .eq("id", inserted.data.id)
      .single()
      .throwOnError();
    expect(data.clock_out_source).toBe("auto");

    // Operators neither see nor resolve alerts.
    expect(
      (await fx.a.operator.rpc("pending_attendance_alerts", { p_org_id: fx.a.org.id })).data,
    ).toEqual([]);
    expect(
      (await fx.a.operator.rpc("resolve_attendance_alert", { p_alert_id: alert!.alert_id })).error
        ?.code,
    ).toBe("P0002");
    const resolved = await fx.a.admin.rpc("resolve_attendance_alert", {
      p_alert_id: alert!.alert_id,
      p_note: "Provjereno s radnikom",
    });
    expect(resolved.error).toBeNull();
    const after = await fx.a.admin.rpc("pending_attendance_alerts", { p_org_id: fx.a.org.id });
    expect(after.data?.some((row) => row.alert_id === alert!.alert_id)).toBe(false);
  });
});

describe("work on operations", () => {
  it("blocks work without a clock-in when the organization says so", async () => {
    await clockOutIfOpen();
    const denied = await fx.a.operator
      .from("attendance_settings")
      .update({ operation_without_clock_in: "block" }, { count: "exact" })
      .eq("organization_id", fx.a.org.id);
    expect(denied.count).toBe(0);
    await fx.a.admin
      .from("attendance_settings")
      .update({ operation_without_clock_in: "block" })
      .eq("organization_id", fx.a.org.id)
      .throwOnError();

    const operation = await readyOperation(ids.p1);
    const start = await fx.a.operator.rpc("start_operation_work", { p_operation_id: operation });
    expect(start.error?.message).toBe("not_clocked_in");
  });

  it("clocks the worker in automatically, alerts the foreman and never doubles presence on two machines", async () => {
    await fx.a.admin
      .from("attendance_settings")
      .update({ operation_without_clock_in: "auto_clock_in" })
      .eq("organization_id", fx.a.org.id)
      .throwOnError();
    const first = await readyOperation(ids.p1);
    const second = await readyOperation(ids.p2);

    expect(
      (await fx.a.operator.rpc("start_operation_work", { p_operation_id: first })).error,
    ).toBeNull();
    const open = await openSessions(ids.operatorEmployee);
    expect(open).toHaveLength(1);
    expect(open[0]!.clock_in_source).toBe("operation");
    const alerts = await fx.a.admin.rpc("pending_attendance_alerts", { p_org_id: fx.a.org.id });
    expect(
      alerts.data?.some((row) => row.session_id === open[0]!.id && row.kind === "auto_clock_in"),
    ).toBe(true);

    // Second machine at the same time: two work sessions, one presence.
    expect(
      (await fx.a.operator.rpc("start_operation_work", { p_operation_id: second })).error,
    ).toBeNull();
    const work = await fx.service
      .from("production_work_sessions")
      .select("machine_id")
      .eq("employee_id", ids.operatorEmployee)
      .is("ended_at", null)
      .throwOnError();
    expect(new Set(work.data.map((row) => row.machine_id))).toEqual(new Set([ids.m1, ids.m2]));
    expect(await openSessions(ids.operatorEmployee)).toHaveLength(1);

    const mine = await fx.a.operator.rpc("my_attendance", {
      p_org_id: fx.a.org.id,
      p_from: "2000-01-01",
      p_to: "2100-01-01",
    });
    expect(mine.error).toBeNull();
    expect((mine.data as { open: { id: string } | null }).open?.id).toBe(open[0]!.id);
  });
});
