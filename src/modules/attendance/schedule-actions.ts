"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, invalidFields, type ActionResult, type DbError } from "@/lib/actions/result";
import { permitAction } from "@/lib/auth/require-permission";
import { requireMember } from "@/lib/auth/session";
import { nullableParam } from "@/lib/supabase/numeric";
import { createClient } from "@/lib/supabase/server";
import {
  applyRangeSchema,
  ASSIGNMENT_FIELDS,
  assignmentSchema,
  copyWeekSchema,
  CREW_FIELDS,
  crewSchema,
  ROTATION_FIELDS,
  rotationSchema,
  scheduleEntriesSchema,
  type AssignmentField,
  type CrewField,
  type RotationField,
} from "./schedule-schemas";

// Schedule, crews and rotations. Every mutation needs attendance.manage
// (checked here and again in the database functions).

type SimpleResult =
  | { ok: true; count?: number }
  | { ok: false; error: "invalid" | "denied" | "not_found" | "unexpected" };

function revalidateSchedule() {
  revalidatePath("/attendance", "layout");
  revalidatePath("/floor/attendance");
}

function simpleError(error: DbError, context: string): SimpleResult {
  switch (error?.code) {
    case "42501":
      return { ok: false, error: "denied" };
    case "P0002":
      return { ok: false, error: "not_found" };
    case "22023":
    case "23503":
    case "23505":
    case "23514":
      return { ok: false, error: "invalid" };
    default:
      console.error(`${context} failed`, error);
      return { ok: false, error: "unexpected" };
  }
}

async function manager(): Promise<string | null> {
  const member = await requireMember();
  return (await permitAction(member.organization.id, "attendance.manage"))
    ? member.organization.id
    : null;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
export async function setScheduleEntriesAction(input: unknown): Promise<SimpleResult> {
  const org = await manager();
  if (!org) return { ok: false, error: "denied" };
  const parsed = scheduleEntriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_schedule_entries", {
    p_org_id: org,
    p_entries: parsed.data.map((entry) => ({
      employee_id: entry.employeeId,
      work_date: entry.workDate,
      shift_id: entry.shiftId,
    })),
  });
  if (error) return simpleError(error, "set schedule");
  revalidateSchedule();
  return { ok: true, count: data };
}

export async function applyRotationsAction(input: unknown): Promise<SimpleResult> {
  const org = await manager();
  if (!org) return { ok: false, error: "denied" };
  const parsed = applyRangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_rotations", {
    p_org_id: org,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  });
  if (error) return simpleError(error, "apply rotations");
  revalidateSchedule();
  return { ok: true, count: data };
}

export async function copyScheduleWeekAction(input: unknown): Promise<SimpleResult> {
  const org = await manager();
  if (!org) return { ok: false, error: "denied" };
  const parsed = copyWeekSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_schedule_week", {
    p_org_id: org,
    p_source_monday: parsed.data.sourceMonday,
    p_target_monday: parsed.data.targetMonday,
  });
  if (error) return simpleError(error, "copy week");
  revalidateSchedule();
  return { ok: true, count: data };
}

// ---------------------------------------------------------------------------
// Crews
// ---------------------------------------------------------------------------
export type CrewActionResult = ActionResult<CrewField, "duplicate_name">;

export async function saveCrewAction(
  crewId: string | null,
  input: unknown,
): Promise<CrewActionResult> {
  const org = await manager();
  if (!org) return actionFail("denied");
  const parsedId = z.uuid().nullable().safeParse(crewId);
  const parsed = crewSchema.safeParse(input);
  if (!parsedId.success) return actionFail("invalid");
  if (!parsed.success) return actionFail("invalid", invalidFields(parsed.error, CREW_FIELDS));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_crew", {
    p_org_id: org,
    p_id: nullableParam(parsedId.data),
    p_name: parsed.data.name,
    p_color: parsed.data.color,
    p_employee_ids: parsed.data.employeeIds,
  });
  if (error) {
    if (error.code === "23505") return actionFail("duplicate_name", ["name"]);
    const result = simpleError(error, "save crew");
    return actionFail(result.ok ? "unexpected" : result.error);
  }
  revalidateSchedule();
  return { ok: true, id: data };
}

export async function setCrewArchivedAction(
  crewId: unknown,
  archived: boolean,
): Promise<SimpleResult> {
  const org = await manager();
  if (!org) return { ok: false, error: "denied" };
  const parsed = z.uuid().safeParse(crewId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_crew_archived", {
    p_crew_id: parsed.data,
    p_archived: archived,
  });
  if (error) return simpleError(error, "archive crew");
  revalidateSchedule();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rotations
// ---------------------------------------------------------------------------
export type RotationActionResult = ActionResult<RotationField, "duplicate_name">;

export async function saveRotationAction(
  rotationId: string | null,
  input: unknown,
): Promise<RotationActionResult> {
  const org = await manager();
  if (!org) return actionFail("denied");
  const parsedId = z.uuid().nullable().safeParse(rotationId);
  const parsed = rotationSchema.safeParse(input);
  if (!parsedId.success) return actionFail("invalid");
  if (!parsed.success) return actionFail("invalid", invalidFields(parsed.error, ROTATION_FIELDS));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_rotation", {
    p_org_id: org,
    p_id: nullableParam(parsedId.data),
    p_name: parsed.data.name,
    p_cycle_days: parsed.data.cycleDays,
    p_days: parsed.data.days.flatMap((shiftId, day) =>
      shiftId ? [{ day, shift_id: shiftId }] : [],
    ),
  });
  if (error) {
    if (error.code === "23505") return actionFail("duplicate_name", ["name"]);
    const result = simpleError(error, "save rotation");
    return actionFail(result.ok ? "unexpected" : result.error);
  }
  revalidateSchedule();
  return { ok: true, id: data };
}

export async function setRotationArchivedAction(
  rotationId: unknown,
  archived: boolean,
): Promise<SimpleResult> {
  const org = await manager();
  if (!org) return { ok: false, error: "denied" };
  const parsed = z.uuid().safeParse(rotationId);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_rotation_archived", {
    p_rotation_id: parsed.data,
    p_archived: archived,
  });
  if (error) return simpleError(error, "archive rotation");
  revalidateSchedule();
  return { ok: true };
}

export type AssignmentActionResult = ActionResult<AssignmentField>;

export async function assignRotationAction(input: unknown): Promise<AssignmentActionResult> {
  const org = await manager();
  if (!org) return actionFail("denied");
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) {
    return actionFail("invalid", invalidFields(parsed.error, ASSIGNMENT_FIELDS));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_rotation", {
    p_org_id: org,
    p_rotation_id: parsed.data.rotationId,
    p_crew_id: nullableParam(parsed.data.target === "crew" ? parsed.data.targetId : null),
    p_employee_id: nullableParam(parsed.data.target === "employee" ? parsed.data.targetId : null),
    p_start_date: parsed.data.startDate,
    p_end_date: nullableParam(parsed.data.endDate),
  });
  if (error) {
    const result = simpleError(error, "assign rotation");
    return actionFail(result.ok ? "unexpected" : result.error);
  }
  revalidateSchedule();
  return { ok: true, id: data };
}

export async function endAssignmentAction(
  assignmentId: unknown,
  endDate: unknown,
): Promise<SimpleResult> {
  const org = await manager();
  if (!org) return { ok: false, error: "denied" };
  const parsedId = z.uuid().safeParse(assignmentId);
  const parsedDate = z.iso.date().safeParse(endDate);
  if (!parsedId.success || !parsedDate.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_rotation_assignment", {
    p_assignment_id: parsedId.data,
    p_end_date: parsedDate.data,
  });
  if (error) return simpleError(error, "end assignment");
  revalidateSchedule();
  return { ok: true };
}
