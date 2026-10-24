import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dbErrorKind, invalidFields, violates } from "./result";

describe("invalidFields", () => {
  it("returns only known top-level fields, in declared order", () => {
    const schema = z.object({ a: z.string().min(1), b: z.array(z.uuid()), c: z.string() });
    const result = schema.safeParse({ a: "", b: ["nope"], c: 1, extra: true });
    expect(result.success).toBe(false);
    expect(invalidFields(result.error!, ["c", "a", "b"] as const)).toEqual(["c", "a", "b"]);
    expect(invalidFields(result.error!, ["a"] as const)).toEqual(["a"]);
  });
});

describe("dbErrorKind", () => {
  it("maps Postgres and PostgREST codes", () => {
    expect(dbErrorKind({ code: "23505" })).toBe("unique");
    expect(dbErrorKind({ code: "23503" })).toBe("foreign_key");
    expect(dbErrorKind({ code: "42501" })).toBe("denied");
    expect(dbErrorKind({ code: "P0002" })).toBe("not_found");
    expect(dbErrorKind({ code: "PGRST116" })).toBe("not_found");
    expect(dbErrorKind({ code: "XX000" })).toBe("other");
    expect(dbErrorKind(null)).toBe("other");
  });
});

describe("violates", () => {
  const error = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "machines_code_key"',
  };

  it("matches the exact constraint name", () => {
    expect(violates(error, "machines_code_key")).toBe(true);
    expect(violates(error, "machines_code")).toBe(false);
    expect(violates({ ...error, code: "23503" }, "machines_code_key")).toBe(false);
  });
});
