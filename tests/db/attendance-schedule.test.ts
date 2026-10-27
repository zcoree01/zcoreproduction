import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/types";
import { setupFixture, type Fixture } from "./fixtures";

// Attendance part B1: crews (one per employee), rotations written into the
// schedule (manual entries stay, the employee's own rotation wins over the
// crew's), copying a week, ending an assignment, the worker's own schedule,
// shift recognition from the schedule, RLS and tenant isolation. Rows use
// the DBS prefix.

const MARK = "DBS";
type Client = SupabaseClient<Database>;

let fx: Fixture;
const ids = {
  operatorEmployee: "",
  a: "",
  b: "",
  first: "",
  second: "",
  night: "",
};

async function cleanup(service: Client, orgIds: string[]) {
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
    await service.from("shift_rotation_assignments").delete().in("employee_id", employeeIds);
    await service.from("shift_crew_members").delete().in("employee_id", employeeIds);
  }
  const crews = await service
    .from("shift_crews")
    .select("id")
    .in("organization_id", orgIds)
    .like("name", `${MARK} %`);
  const crewIds = (crews.data ?? []).map((row) => row.id);
  if (crewIds.length > 0) {
    await service.from("shift_rotation_assignments").delete().in("crew_id", crewIds);
    await service.from("shift_crews").delete().in("id", crewIds);
  }
  const rotations = await service
    .from("shift_rotations")
    .select("id")
    .in("organization_id", orgIds)
    .like("name", `${MARK} %`);
  const rotationIds = (rotations.data ?? []).map((row) => row.id);
  if (rotationIds.length > 0) {
    await service.from("shift_rotation_assignments").delete().in("rotation_id", rotationIds);
    await service.from("shift_rotations").delete().in("id", rotationIds);
  }
  if (employeeIds.length > 0) {
    await service.from("employees").delete().in("id", employeeIds);
  }
  await service.from("shifts").delete().in("organization_id", orgIds).like("name", `${MARK} %`);
}

async function shift(name: string, code: string, startsAt: string, endsAt: string) {
  const { data, error } = await fx.a.admin.rpc("save_shift", {
    p_org_id: fx.a.org.id,
    p_id: null as unknown as string,
    p_name: `${MARK} ${name}`,
    p_code: code,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_color: "",
    p_breaks: [] as Json,
  });
  expect(error).toBeNull();
  return data!;
}

async function schedule(employeeId: string, from: string, to: string) {
  const { data } = await fx.service
    .from("shift_schedule")
    .select("work_date, shift_id, source")
    .eq("employee_id", employeeId)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date")
    .throwOnError();
  return data;
}

beforeAll(async () => {
  fx = await setupFixture();
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
  const employees = await fx.service
    .from("employees")
    .insert([
      {
        organization_id: fx.a.org.id,
        employee_number: 900401,
        first_name: `${MARK} Operater`,
        last_name: "Raspored",
        user_id: fx.a.operatorId,
      },
      {
        organization_id: fx.a.org.id,
        employee_number: 900402,
        first_name: `${MARK} Ana`,
        last_name: "A",
      },
      {
        organization_id: fx.a.org.id,
        employee_number: 900403,
        first_name: `${MARK} Bego`,
        last_name: "B",
      },
    ])
    .select("id, employee_number")
    .throwOnError();
  const byNumber = (n: number) => employees.data.find((e) => e.employee_number === n)!.id;
  ids.operatorEmployee = byNumber(900401);
  ids.a = byNumber(900402);
  ids.b = byNumber(900403);
  ids.first = await shift("Prva", "SI", "06:00", "14:00");
  ids.second = await shift("Druga", "SII", "14:00", "22:00");
  ids.night = await shift("Noćna", "SIII", "22:00", "06:00");
});

afterAll(async () => {
  await cleanup(fx.service, [fx.a.org.id, fx.b.org.id]);
});

describe("crews", () => {
  it("keep an employee in one crew and are managed with attendance.manage", async () => {
    const denied = await fx.a.operator.rpc("save_crew", {
      p_org_id: fx.a.org.id,
      p_id: null as unknown as string,
      p_name: `${MARK} Zabranjena`,
      p_color: "",
      p_employee_ids: [],
    });
    expect(denied.error?.code).toBe("42501");

    const red = await fx.a.admin.rpc("save_crew", {
      p_org_id: fx.a.org.id,
      p_id: null as unknown as string,
      p_name: `${MARK} Crvena`,
      p_color: "#ef4444",
      p_employee_ids: [ids.a, ids.operatorEmployee],
    });
    expect(red.error).toBeNull();
    const blue = await fx.a.admin.rpc("save_crew", {
      p_org_id: fx.a.org.id,
      p_id: null as unknown as string,
      p_name: `${MARK} Plava`,
      p_color: "",
      p_employee_ids: [ids.b, ids.operatorEmployee],
    });
    expect(blue.error).toBeNull();
    const { data } = await fx.service
      .from("shift_crew_members")
      .select("crew_id, employee_id")
      .in("employee_id", [ids.a, ids.b, ids.operatorEmployee])
      .throwOnError();
    const crewOf = (employee: string) => data.find((row) => row.employee_id === employee)?.crew_id;
    expect(crewOf(ids.a)).toBe(red.data);
    expect(crewOf(ids.b)).toBe(blue.data);
    // Moved, not duplicated.
    expect(crewOf(ids.operatorEmployee)).toBe(blue.data);
    expect(data.filter((row) => row.employee_id === ids.operatorEmployee)).toHaveLength(1);

    const foreign = await fx.b.admin.rpc("save_crew", {
      p_org_id: fx.b.org.id,
      p_id: null as unknown as string,
      p_name: `${MARK} Strana`,
      p_color: "",
      p_employee_ids: [ids.a],
    });
    expect(foreign.error?.code).toBe("23503");
  });
});

describe("rotations", () => {
  let weekly = "";
  let crewRed = "";

  beforeAll(async () => {
    // Week of I shift (Mon–Fri), weekend off, week of II shift, weekend off.
    const days = [0, 1, 2, 3, 4]
      .map((day) => ({ day, shift_id: ids.first }))
      .concat([7, 8, 9, 10, 11].map((day) => ({ day, shift_id: ids.second })));
    const saved = await fx.a.admin.rpc("save_rotation", {
      p_org_id: fx.a.org.id,
      p_id: null as unknown as string,
      p_name: `${MARK} Sedmična izmjena`,
      p_cycle_days: 14,
      p_days: days as Json,
    });
    expect(saved.error).toBeNull();
    weekly = saved.data!;
    const crews = await fx.service
      .from("shift_crews")
      .select("id, name")
      .like("name", `${MARK} Crvena`)
      .single()
      .throwOnError();
    crewRed = crews.data.id;
  });

  it("are validated", async () => {
    const bad = await fx.a.admin.rpc("save_rotation", {
      p_org_id: fx.a.org.id,
      p_id: null as unknown as string,
      p_name: `${MARK} Loša`,
      p_cycle_days: 7,
      p_days: [{ day: 9, shift_id: ids.first }] as Json,
    });
    expect(bad.error?.code).toBe("22023");
  });

  it("are written into the schedule; manual days stay; an own rotation beats the crew's", async () => {
    // Crew Crvena (employee A) starts on Monday 2 Nov 2026.
    const crewAssignment = await fx.a.admin.rpc("assign_rotation", {
      p_org_id: fx.a.org.id,
      p_rotation_id: weekly,
      p_crew_id: crewRed,
      p_employee_id: null as unknown as string,
      p_start_date: "2026-11-02",
      p_end_date: null as unknown as string,
    });
    expect(crewAssignment.error).toBeNull();
    // Employee B on its own, one week shifted (II shift first).
    const own = await fx.a.admin.rpc("assign_rotation", {
      p_org_id: fx.a.org.id,
      p_rotation_id: weekly,
      p_crew_id: null as unknown as string,
      p_employee_id: ids.b,
      p_start_date: "2026-10-26",
      p_end_date: null as unknown as string,
    });
    expect(own.error).toBeNull();

    // A manual night shift on Wednesday for A survives.
    expect(
      (
        await fx.a.admin.rpc("set_schedule_entries", {
          p_org_id: fx.a.org.id,
          p_entries: [{ employee_id: ids.a, work_date: "2026-11-04", shift_id: ids.night }] as Json,
        })
      ).error,
    ).toBeNull();

    const applied = await fx.a.admin.rpc("apply_rotations", {
      p_org_id: fx.a.org.id,
      p_from: "2026-11-02",
      p_to: "2026-11-15",
    });
    expect(applied.error).toBeNull();

    const a = await schedule(ids.a, "2026-11-02", "2026-11-15");
    expect(
      a.map((row) => [
        row.work_date,
        row.shift_id === ids.first ? "I" : row.shift_id === ids.second ? "II" : "N",
        row.source,
      ]),
    ).toEqual([
      ["2026-11-02", "I", "rotation"],
      ["2026-11-03", "I", "rotation"],
      ["2026-11-04", "N", "manual"],
      ["2026-11-05", "I", "rotation"],
      ["2026-11-06", "I", "rotation"],
      ["2026-11-09", "II", "rotation"],
      ["2026-11-10", "II", "rotation"],
      ["2026-11-11", "II", "rotation"],
      ["2026-11-12", "II", "rotation"],
      ["2026-11-13", "II", "rotation"],
    ]);
    const b = await schedule(ids.b, "2026-11-02", "2026-11-06");
    expect(b.every((row) => row.shift_id === ids.second)).toBe(true);
    expect(b).toHaveLength(5);

    // Running it again changes nothing.
    await fx.a.admin.rpc("apply_rotations", {
      p_org_id: fx.a.org.id,
      p_from: "2026-11-02",
      p_to: "2026-11-15",
    });
    expect(await schedule(ids.a, "2026-11-02", "2026-11-15")).toEqual(a);
  });

  it("refuses a range over 62 days", async () => {
    const tooLong = await fx.a.admin.rpc("apply_rotations", {
      p_org_id: fx.a.org.id,
      p_from: "2026-11-01",
      p_to: "2027-01-15",
    });
    expect(tooLong.error?.code).toBe("22023");
  });

  it("recognises the scheduled shift at clock-in", async () => {
    const { data } = await fx.a.admin.rpc("attendance_shift_for", {
      p_employee_id: ids.a,
      // 13:30 on a day planned as II shift: II, not the closer I shift end.
      p_at: "2026-11-09T12:30:00Z",
    });
    expect(data?.[0]?.shift_id).toBe(ids.second);
  });

  it("removes rotation days after an assignment ends", async () => {
    const assignment = await fx.service
      .from("shift_rotation_assignments")
      .select("id")
      .eq("crew_id", crewRed)
      .single()
      .throwOnError();
    expect(
      (
        await fx.a.admin.rpc("end_rotation_assignment", {
          p_assignment_id: assignment.data.id,
          p_end_date: "2026-11-08",
        })
      ).error,
    ).toBeNull();
    const a = await schedule(ids.a, "2026-11-09", "2026-11-15");
    expect(a).toEqual([]);
    // The manual day before stays.
    expect((await schedule(ids.a, "2026-11-04", "2026-11-04"))[0]?.source).toBe("manual");
  });
});

describe("copying a week", () => {
  it("copies Monday–Sunday to the target week as manual days", async () => {
    const bad = await fx.a.admin.rpc("copy_schedule_week", {
      p_org_id: fx.a.org.id,
      p_source_monday: "2026-11-03",
      p_target_monday: "2026-11-16",
    });
    expect(bad.error?.code).toBe("22023");

    const copied = await fx.a.admin.rpc("copy_schedule_week", {
      p_org_id: fx.a.org.id,
      p_source_monday: "2026-11-02",
      p_target_monday: "2026-11-23",
    });
    expect(copied.error).toBeNull();
    const target = await schedule(ids.a, "2026-11-23", "2026-11-29");
    expect(target.map((row) => row.work_date)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
    ]);
    expect(target.every((row) => row.source === "manual")).toBe(true);
    expect(target[2]?.shift_id).toBe(ids.night);
  });
});

describe("access", () => {
  it("shows a worker only their own schedule and keeps tenants apart", async () => {
    await fx.a.admin.rpc("set_schedule_entries", {
      p_org_id: fx.a.org.id,
      p_entries: [
        { employee_id: ids.operatorEmployee, work_date: "2026-11-20", shift_id: ids.first },
      ] as Json,
    });
    const mine = await fx.a.operator.rpc("my_schedule", {
      p_org_id: fx.a.org.id,
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    });
    expect(mine.error).toBeNull();
    expect(mine.data?.map((row) => row.work_date)).toEqual(["2026-11-20"]);

    expect(
      (
        await fx.a.operator.rpc("schedule_range", {
          p_org_id: fx.a.org.id,
          p_from: "2026-11-01",
          p_to: "2026-11-30",
        })
      ).data,
    ).toBeNull();
    expect(
      (
        await fx.a.operator.rpc("set_schedule_entries", {
          p_org_id: fx.a.org.id,
          p_entries: [{ employee_id: ids.a, work_date: "2026-11-21", shift_id: ids.first }] as Json,
        })
      ).error?.code,
    ).toBe("42501");
    const crews = await fx.a.operator.from("shift_crews").select("id").like("name", `${MARK} %`);
    expect(crews.data).toEqual([]);

    expect(
      (
        await fx.b.admin.rpc("schedule_range", {
          p_org_id: fx.a.org.id,
          p_from: "2026-11-01",
          p_to: "2026-11-30",
        })
      ).data,
    ).toBeNull();
    const foreignWrite = await fx.b.admin.rpc("set_schedule_entries", {
      p_org_id: fx.b.org.id,
      p_entries: [{ employee_id: ids.a, work_date: "2026-11-21", shift_id: ids.first }] as Json,
    });
    expect(foreignWrite.error?.code).toBe("23503");

    const grid = await fx.a.admin.rpc("schedule_range", {
      p_org_id: fx.a.org.id,
      p_from: "2026-11-01",
      p_to: "2026-11-30",
    });
    const rows = (grid.data as { employees: { id: string; crew: string | null }[] }).employees;
    expect(rows.find((row) => row.id === ids.b)?.crew).toBe(`${MARK} Plava`);
  });
});
