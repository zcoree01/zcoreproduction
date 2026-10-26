import { describe, expect, it } from "vitest";
import { employeeSchema, toSaveEmployeeArgs } from "./schemas";

const ORG = "00000000-0000-4000-8000-000000000000";
const SKILL = "11111111-1111-4111-8111-111111111111";
const MACHINE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

const VALID = {
  employeeNumber: "",
  firstName: " Omer ",
  lastName: " Operater ",
  departmentId: "",
  jobTitleId: "",
  userId: USER,
  status: "active",
  skills: [{ skillId: SKILL, level: 2 }],
  machineIds: [MACHINE],
};

describe("employeeSchema", () => {
  it("trims names, maps empty selects to null and an empty number to auto", () => {
    expect(employeeSchema.parse(VALID)).toEqual({
      employeeNumber: null,
      firstName: "Omer",
      lastName: "Operater",
      departmentId: null,
      jobTitleId: null,
      userId: USER,
      status: "active",
      skills: [{ skillId: SKILL, level: 2 }],
      machineIds: [MACHINE],
      newAccountRoleId: null,
    });
  });

  it("links an existing account or creates a new one, not both", () => {
    const ROLE = "44444444-4444-4444-8444-444444444444";
    expect(
      employeeSchema.parse({ ...VALID, userId: "", newAccountRoleId: ROLE }).newAccountRoleId,
    ).toBe(ROLE);
    const both = employeeSchema.safeParse({ ...VALID, newAccountRoleId: ROLE });
    expect(both.error?.issues.map((i) => i.path[0])).toEqual(["newAccountRoleId"]);
  });

  it("accepts employee numbers 1..999999 only", () => {
    expect(employeeSchema.parse({ ...VALID, employeeNumber: " 0042 " }).employeeNumber).toBe(42);
    for (const bad of ["0", "1000000", "12a", "-3", "4.5"]) {
      expect(employeeSchema.safeParse({ ...VALID, employeeNumber: bad }).success, bad).toBe(false);
    }
  });

  it("requires first and last name", () => {
    const result = employeeSchema.safeParse({ ...VALID, firstName: " ", lastName: "" });
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(["firstName", "lastName"]);
  });

  it("rejects unknown skill levels and duplicate skills or machines", () => {
    expect(
      employeeSchema.safeParse({ ...VALID, skills: [{ skillId: SKILL, level: 4 }] }).success,
    ).toBe(false);
    expect(
      employeeSchema.safeParse({
        ...VALID,
        skills: [
          { skillId: SKILL, level: 1 },
          { skillId: SKILL, level: 3 },
        ],
      }).success,
    ).toBe(false);
    expect(employeeSchema.safeParse({ ...VALID, machineIds: [MACHINE, MACHINE] }).success).toBe(
      false,
    );
  });

  it("rejects an unknown status", () => {
    expect(employeeSchema.safeParse({ ...VALID, status: "fired" }).success).toBe(false);
  });
});

describe("toSaveEmployeeArgs", () => {
  it("omits empty optional values so SQL defaults (null) apply", () => {
    const args = toSaveEmployeeArgs(ORG, null, employeeSchema.parse(VALID));
    expect(args).toEqual({
      p_org_id: ORG,
      p_employee_id: undefined,
      p_employee_number: undefined,
      p_first_name: "Omer",
      p_last_name: "Operater",
      p_department_id: undefined,
      p_job_title_id: undefined,
      p_user_id: USER,
      p_status: "active",
      p_skills: [{ skill_id: SKILL, level: 2 }],
      p_machine_ids: [MACHINE],
    });
    // JSON serialization (PostgREST body) drops undefined keys.
    expect(Object.keys(JSON.parse(JSON.stringify(args))).sort()).toEqual([
      "p_first_name",
      "p_last_name",
      "p_machine_ids",
      "p_org_id",
      "p_skills",
      "p_status",
      "p_user_id",
    ]);
  });

  it("passes the employee id and an explicit number when editing", () => {
    const args = toSaveEmployeeArgs(
      ORG,
      SKILL,
      employeeSchema.parse({ ...VALID, employeeNumber: "7" }),
    );
    expect(args.p_employee_id).toBe(SKILL);
    expect(args.p_employee_number).toBe(7);
  });
});
