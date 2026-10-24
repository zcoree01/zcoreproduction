import type { z } from "zod";

// Result contract shared by server actions that save a form: the client shows
// field errors next to fields and everything else above the form.

export type CommonActionError = "invalid" | "denied" | "not_found" | "unexpected";

export type ActionResult<TField extends string, TError extends string = never> =
  { ok: true; id: string } | { ok: false; error: CommonActionError | TError; fields: TField[] };

export function actionFail<TField extends string, TError extends string = never>(
  error: CommonActionError | TError,
  fields: TField[] = [],
): ActionResult<TField, TError> {
  return { ok: false, error, fields };
}

/** Top-level form fields named in a Zod error, restricted to known fields. */
export function invalidFields<TField extends string>(
  error: z.ZodError,
  known: readonly TField[],
): TField[] {
  const named = new Set(error.issues.map((issue) => String(issue.path[0])));
  return known.filter((field) => named.has(field));
}

export type DbError = { code?: string; message?: string } | null | undefined;

/** Postgres error classes the actions translate into user-facing results. */
export function dbErrorKind(
  error: DbError,
): "unique" | "foreign_key" | "denied" | "not_found" | "other" {
  switch (error?.code) {
    case "23505":
      return "unique";
    case "23503":
      return "foreign_key";
    case "42501":
      return "denied";
    case "P0002":
    case "PGRST116":
      return "not_found";
    default:
      return "other";
  }
}

/** True when a unique violation was raised by the named constraint/index. */
export function violates(error: DbError, constraint: string): boolean {
  return error?.code === "23505" && (error.message ?? "").includes(`"${constraint}"`);
}
