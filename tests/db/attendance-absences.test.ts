import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ensureUser } from "@/modules/organizations/provision";
import { testTenantPassword } from "../shared/test-tenants";
import { setupFixture, signIn, type Fixture } from "./fixtures";

// Attendance part B2: absences requested by the worker or entered by a
// manager (no overlap, idempotent), sick-leave details only for the
// employee, the director and HR (also the document in Storage), decisions
// (nobody decides their own; managers' requests need admin / director),
// leave data and used days, corrections (original kept, new session,
// overlap refused, managers correct others at once), pending requests, the
// board, RLS and tenant isolation. Rows use the DBB prefix.

const MARK = "DBB";
type Client = SupabaseClient<Database>;

let fx: Fixture;
let head: Client;
let hr: Client;
let director: Client;
const ids = { worker: "", headEmployee: "", other: "", headUser: "" };
const uploaded: string[] = [];
const key = () => crypto.randomUUID();

async function cleanup(service: Client, orgIds: string[]) {
  const employees = await service
    .from("employees")
    .select("id")
    .in("organization_id", orgIds)
    .like("first_name", `${MARK}%`);
  const employeeIds = (employees.data ?? []).map((row) => row.id);
  if (employeeIds.length === 0) return;
  const absences = await service.from("absences").select("id").in("employee_id", employeeIds);
  const absenceIds = (absences.data ?? []).map((row) => row.id);
  if (absenceIds.length > 0) {
    await service.from("absence_details").delete().in("absence_id", absenceIds);
    await service.from("absences").delete().in("id", absenceIds);
  }
  await service.from("attendance_corrections").delete().in("employee_id", employeeIds);
  await service.from("attendance_alerts").delete().in("employee_id", employeeIds);
  await service.from("attendance_sessions").delete().in("employee_id", employeeIds);
  await service.from("employee_leave_years").delete().in("employee_id", employeeIds);
  await service.from("employee_work_info").delete().in("employee_id", employeeIds);
  await service.from("employees").delete().in("id", employeeIds);
}

async function session(employeeId: string, from: string, to: string) {
  const { data } = await fx.service
    .from("attendance_sessions")
    .insert({
      organization_id: fx.a.org.id,
      employee_id: employeeId,
      work_date: from.slice(0, 10),
      clock_in_at: from,
      clock_out_at: to,
      clock_in_source: "mobile",
      clock_out_source: "mobile",
      idempotency_key: key(),
    })
    .select("id")
    .single()
    .throwOnError();
  return data.id;
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  const s = fx.service;
  const org = fx.a.org;
  const password = testTenantPassword();
  ids.headUser = await ensureUser(s, org, {
    username: "sef",
    password,
    fullName: "Test Šef",
    role: "head_of_production",
  });
  await ensureUser(s, org, {
    username: "kadrovska",
    password,
    fullName: "Test Kadrovska",
    role: "hr",
  });
  await ensureUser(s, org, {
    username: "direktor",
    password,
    fullName: "Test Direktor",
    role: "director",
  });
  head = await signIn("sef", org.slug);
  hr = await signIn("kadrovska", org.slug);
  director = await signIn("direktor", org.slug);

  const employees = await s
    .from("employees")
    .insert([
      {
        organization_id: org.id,
        employee_number: 900501,
        first_name: `${MARK} Radnik`,
        last_name: "Odsustvo",
        user_id: fx.a.operatorId,
      },
      {
        organization_id: org.id,
        employee_number: 900502,
        first_name: `${MARK} Šef`,
        last_name: "Odsustvo",
        user_id: ids.headUser,
      },
      {
        organization_id: org.id,
        employee_number: 900503,
        first_name: `${MARK} Treći`,
        last_name: "X",
      },
    ])
    .select("id, employee_number")
    .throwOnError();
  const byNumber = (n: number) => employees.data.find((e) => e.employee_number === n)!.id;
  ids.worker = byNumber(900501);
  ids.headEmployee = byNumber(900502);
  ids.other = byNumber(900503);
});

afterAll(async () => {
  if (uploaded.length > 0) await fx.service.storage.from("absence-documents").remove(uploaded);
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("absence requests", () => {
  it("are idempotent and never overlap", async () => {
    const requestKey = key();
    const request = () =>
      fx.a.operator.rpc("request_absence", {
        p_org_id: fx.a.org.id,
        p_kind: "vacation",
        p_start: "2026-07-06",
        p_end: "2026-07-17",
        p_note: "More",
        p_reason: null as unknown as string,
        p_idempotency_key: requestKey,
      });
    const first = await request();
    expect(first.error).toBeNull();
    expect((await request()).data).toBe(first.data);
    const overlap = await fx.a.operator.rpc("request_absence", {
      p_org_id: fx.a.org.id,
      p_kind: "day_off",
      p_start: "2026-07-10",
      p_end: "2026-07-10",
      p_note: null as unknown as string,
      p_reason: null as unknown as string,
      p_idempotency_key: key(),
    });
    expect(overlap.error?.message).toBe("absence_overlaps");
    const backwards = await fx.a.operator.rpc("request_absence", {
      p_org_id: fx.a.org.id,
      p_kind: "day_off",
      p_start: "2026-08-10",
      p_end: "2026-08-09",
      p_note: null as unknown as string,
      p_reason: null as unknown as string,
      p_idempotency_key: key(),
    });
    expect(backwards.error?.message).toBe("invalid_period");
  });

  it("keep sick-leave details for the employee, the director and HR", async () => {
    const sick = await fx.a.operator.rpc("request_absence", {
      p_org_id: fx.a.org.id,
      p_kind: "sick",
      p_start: "2026-09-01",
      p_end: "2026-09-04",
      p_note: "Javljam se",
      p_reason: "Gripa",
      p_idempotency_key: key(),
    });
    expect(sick.error).toBeNull();
    const reason = async (client: Client) =>
      (await client.from("absence_details").select("reason").eq("absence_id", sick.data!)).data;
    expect(await reason(fx.a.operator)).toEqual([{ reason: "Gripa" }]);
    expect(await reason(hr)).toEqual([{ reason: "Gripa" }]);
    expect(await reason(director)).toEqual([{ reason: "Gripa" }]);
    expect(await reason(head)).toEqual([]);

    const range = async (client: Client) => {
      const { data } = await client.rpc("absences_range", {
        p_org_id: fx.a.org.id,
        p_from: "2026-09-01",
        p_to: "2026-09-30",
      });
      return (data as { id: string; reason: string | null; note: string | null }[]).find(
        (row) => row.id === sick.data,
      );
    };
    expect(await range(head)).toMatchObject({ reason: null, note: "Javljam se" });
    expect(await range(hr)).toMatchObject({ reason: "Gripa" });

    // The sick note: the worker uploads it; HR reads it, the head of production cannot.
    const path = `${fx.a.org.id}/${sick.data}/${key()}.png`;
    const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    });
    const upload = await fx.a.operator.storage.from("absence-documents").upload(path, png, {
      contentType: "image/png",
    });
    expect(upload.error).toBeNull();
    uploaded.push(path);
    expect(
      (
        await fx.a.operator.rpc("attach_absence_document", {
          p_absence_id: sick.data!,
          p_path: path,
          p_name: "doznaka.png",
          p_type: "image/png",
          p_size: 8,
        })
      ).error,
    ).toBeNull();
    expect((await hr.storage.from("absence-documents").download(path)).error).toBeNull();
    expect((await fx.a.operator.storage.from("absence-documents").download(path)).error).toBeNull();
    expect((await head.storage.from("absence-documents").download(path)).error).not.toBeNull();
    const foreign = await fx.b.admin.storage
      .from("absence-documents")
      .upload(`${fx.a.org.id}/${sick.data}/${key()}.png`, png, { contentType: "image/png" });
    expect(foreign.error).not.toBeNull();
  });
});

describe("decisions", () => {
  it("let the head of production decide a worker's request, never their own", async () => {
    const pending = await head.rpc("pending_requests", { p_org_id: fx.a.org.id });
    const vacation = (
      pending.data as { absences: { id: string; kind: string; working_days: number }[] }
    ).absences.find((row) => row.kind === "vacation");
    expect(vacation?.working_days).toBe(10);
    expect(
      (
        (await fx.a.operator.rpc("pending_requests", { p_org_id: fx.a.org.id })).data as {
          absences: unknown[];
        }
      ).absences,
    ).toEqual([]);

    expect(
      (await fx.a.operator.rpc("decide_absence", { p_absence_id: vacation!.id, p_approve: true }))
        .error?.code,
    ).toBe("P0002");
    const reject = await head.rpc("decide_absence", {
      p_absence_id: vacation!.id,
      p_approve: false,
    });
    expect(reject.error?.message).toBe("reject_note_required");
    expect(
      (await head.rpc("decide_absence", { p_absence_id: vacation!.id, p_approve: true })).error,
    ).toBeNull();
    expect(
      (await head.rpc("decide_absence", { p_absence_id: vacation!.id, p_approve: true })).error
        ?.message,
    ).toBe("already_decided");
  });

  it("send a manager's own request to admin / director", async () => {
    const own = await head.rpc("request_absence", {
      p_org_id: fx.a.org.id,
      p_kind: "day_off",
      p_start: "2026-12-24",
      p_end: "2026-12-24",
      p_note: null as unknown as string,
      p_reason: null as unknown as string,
      p_idempotency_key: key(),
    });
    expect(own.error).toBeNull();
    expect(
      (await head.rpc("decide_absence", { p_absence_id: own.data!, p_approve: true })).error?.code,
    ).toBe("42501");
    // HR manages absences but not managers' requests.
    expect(
      (await hr.rpc("decide_absence", { p_absence_id: own.data!, p_approve: true })).error?.code,
    ).toBe("42501");
    expect(
      (await director.rpc("decide_absence", { p_absence_id: own.data!, p_approve: true })).error,
    ).toBeNull();
  });

  it("approve a manager's entry for others at once, as a request for themselves", async () => {
    const forOther = await head.rpc("enter_absence", {
      p_org_id: fx.a.org.id,
      p_employee_id: ids.other,
      p_kind: "paid_leave",
      p_start: "2026-10-27",
      p_end: "2026-10-27",
      p_note: "Selidba",
      p_reason: null as unknown as string,
      p_idempotency_key: key(),
    });
    expect(forOther.error).toBeNull();
    const forSelf = await head.rpc("enter_absence", {
      p_org_id: fx.a.org.id,
      p_employee_id: ids.headEmployee,
      p_kind: "day_off",
      p_start: "2026-11-02",
      p_end: "2026-11-02",
      p_note: null as unknown as string,
      p_reason: null as unknown as string,
      p_idempotency_key: key(),
    });
    const { data } = await fx.service
      .from("absences")
      .select("id, status")
      .in("id", [forOther.data!, forSelf.data!])
      .throwOnError();
    expect(data.find((row) => row.id === forOther.data)?.status).toBe("approved");
    expect(data.find((row) => row.id === forSelf.data)?.status).toBe("requested");

    const board = await head.rpc("attendance_board", {
      p_org_id: fx.a.org.id,
      p_date: "2026-10-27",
    });
    const row = (
      board.data as { employees: { id: string; absence: string | null }[] }
    ).employees.find((item) => item.id === ids.other);
    expect(row?.absence).toBe("paid_leave");
  });
});

describe("leave data", () => {
  it("is set by HR and counts approved vacation days in the year", async () => {
    const saved = await hr.rpc("save_leave_data", {
      p_employee_id: ids.worker,
      p_year: 2026,
      p_hired_on: "2018-04-01",
      p_prior_service_months: 24,
      p_carried_over_days: 3 as unknown as number,
      p_entitlement_override: null as unknown as number,
    });
    expect(saved.error).toBeNull();
    expect(
      (
        await fx.a.operator.rpc("save_leave_data", {
          p_employee_id: ids.worker,
          p_year: 2026,
          p_hired_on: "2018-04-01",
          p_prior_service_months: 0,
          p_carried_over_days: 0,
          p_entitlement_override: 40,
        })
      ).error?.code,
    ).toBe("42501");
    const mine = await fx.a.operator.rpc("my_requests", { p_org_id: fx.a.org.id, p_year: 2026 });
    expect((mine.data as { leave: unknown }).leave).toMatchObject({
      hired_on: "2018-04-01",
      prior_service_months: 24,
      carried_over_days: 3,
      used_days: 10,
      pending_days: 0,
      rules: { base_days: 20, extra_every_years: 5 },
    });
  });
});

describe("corrections", () => {
  it("keep the original and record a new session when approved", async () => {
    const original = await session(ids.worker, "2026-10-20T04:00:00Z", "2026-10-20T08:00:00Z");
    const request = await fx.a.operator.rpc("request_correction", {
      p_org_id: fx.a.org.id,
      p_session_id: original,
      p_clock_in_at: "2026-10-20T04:00:00Z",
      p_clock_out_at: "2026-10-20T12:00:00Z",
      p_reason: "Zaboravio sam se odjaviti u 14h",
      p_idempotency_key: key(),
    });
    expect(request.error).toBeNull();
    const twice = await fx.a.operator.rpc("request_correction", {
      p_org_id: fx.a.org.id,
      p_session_id: original,
      p_clock_in_at: "2026-10-20T04:00:00Z",
      p_clock_out_at: "2026-10-20T12:30:00Z",
      p_reason: "Još jednom",
      p_idempotency_key: key(),
    });
    expect(twice.error?.message).toBe("correction_pending");
    expect(
      (await head.rpc("decide_correction", { p_correction_id: request.data!, p_approve: true }))
        .error,
    ).toBeNull();

    const { data } = await fx.service
      .from("attendance_corrections")
      .select("status, new_session_id")
      .eq("id", request.data!)
      .single()
      .throwOnError();
    expect(data.status).toBe("approved");
    const sessions = await fx.service
      .from("attendance_sessions")
      .select("id, archived_at, clock_out_at, clock_in_source, clock_out_source")
      .in("id", [original, data.new_session_id!])
      .throwOnError();
    const before = sessions.data.find((row) => row.id === original)!;
    const after = sessions.data.find((row) => row.id === data.new_session_id)!;
    expect(before.archived_at).not.toBeNull();
    expect(Date.parse(before.clock_out_at!)).toBe(Date.parse("2026-10-20T08:00:00Z"));
    expect(after).toMatchObject({
      archived_at: null,
      clock_in_source: "manual",
      clock_out_source: "manual",
    });
    expect(Date.parse(after.clock_out_at!)).toBe(Date.parse("2026-10-20T12:00:00Z"));
  });

  it("refuse overlaps and the future; managers correct others at once", async () => {
    await session(ids.other, "2026-10-21T04:00:00Z", "2026-10-21T12:00:00Z");
    const overlap = await head.rpc("enter_correction", {
      p_org_id: fx.a.org.id,
      p_employee_id: ids.other,
      p_session_id: null as unknown as string,
      p_clock_in_at: "2026-10-21T11:00:00Z",
      p_clock_out_at: "2026-10-21T13:00:00Z",
      p_reason: "Dodatni rad",
      p_idempotency_key: key(),
    });
    expect(overlap.error?.message).toBe("correction_overlaps");
    const future = await head.rpc("enter_correction", {
      p_org_id: fx.a.org.id,
      p_employee_id: ids.other,
      p_session_id: null as unknown as string,
      p_clock_in_at: "2030-01-01T06:00:00Z",
      p_clock_out_at: "2030-01-01T14:00:00Z",
      p_reason: "Budućnost",
      p_idempotency_key: key(),
    });
    expect(future.error?.message).toBe("correction_in_future");
    const added = await head.rpc("enter_correction", {
      p_org_id: fx.a.org.id,
      p_employee_id: ids.other,
      p_session_id: null as unknown as string,
      p_clock_in_at: "2026-10-22T04:00:00Z",
      p_clock_out_at: "2026-10-22T12:00:00Z",
      p_reason: "Zaboravio prijavu",
      p_idempotency_key: key(),
    });
    expect(added.error).toBeNull();
    const { data } = await fx.service
      .from("attendance_corrections")
      .select("status, new_session_id")
      .eq("id", added.data!)
      .single()
      .throwOnError();
    expect(data.status).toBe("approved");
    expect(data.new_session_id).not.toBeNull();
  });

  it("send a manager's own correction to admin / director", async () => {
    const own = await head.rpc("enter_correction", {
      p_org_id: fx.a.org.id,
      p_employee_id: ids.headEmployee,
      p_session_id: null as unknown as string,
      p_clock_in_at: "2026-10-23T04:00:00Z",
      p_clock_out_at: "2026-10-23T12:00:00Z",
      p_reason: "Bio na terenu",
      p_idempotency_key: key(),
    });
    expect(own.error).toBeNull();
    expect(
      (await head.rpc("decide_correction", { p_correction_id: own.data!, p_approve: true })).error
        ?.code,
    ).toBe("42501");
    expect(
      (await fx.a.admin.rpc("decide_correction", { p_correction_id: own.data!, p_approve: true }))
        .error,
    ).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("keeps absences and corrections inside the organization", async () => {
    const foreign = await fx.b.admin
      .from("absences")
      .select("id")
      .eq("organization_id", fx.a.org.id);
    expect(foreign.data).toEqual([]);
    expect(
      (
        await fx.b.admin.rpc("absences_range", {
          p_org_id: fx.a.org.id,
          p_from: "2026-01-01",
          p_to: "2026-12-31",
        })
      ).data,
    ).toBeNull();
    expect(
      (
        await fx.b.admin.rpc("enter_absence", {
          p_org_id: fx.b.org.id,
          p_employee_id: ids.worker,
          p_kind: "day_off",
          p_start: "2026-11-05",
          p_end: "2026-11-05",
          p_note: null as unknown as string,
          p_reason: null as unknown as string,
          p_idempotency_key: key(),
        })
      ).error?.code,
    ).toBe("23503");
    expect(
      (
        await fx.b.operator.rpc("request_absence", {
          p_org_id: fx.b.org.id,
          p_kind: "day_off",
          p_start: "2026-11-05",
          p_end: "2026-11-05",
          p_note: null as unknown as string,
          p_reason: null as unknown as string,
          p_idempotency_key: key(),
        })
      ).error?.message,
    ).toBe("not_an_employee");
  });
});
