import { z } from "zod";
import { usernameSchema } from "@/lib/auth/username";

// Shared by the client form (react-hook-form) and the server action. The
// password is never entered: the server generates a temporary one.
export const createUserSchema = z.object({
  // Empty = generate from the full name (ime.p, ime.pr, …; see username-suggest.ts).
  username: z.union([
    z
      .string()
      .trim()
      .length(0)
      .transform(() => null),
    usernameSchema,
  ]),
  fullName: z.string().trim().min(1).max(200),
  roleId: z.uuid(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateUserFormValues = z.input<typeof createUserSchema>;

export const CREATE_USER_FIELDS = ["username", "fullName", "roleId"] as const;

export type CreateUserField = (typeof CREATE_USER_FIELDS)[number];

export type CreateUserError =
  "invalid" | "denied" | "username_taken" | "role_not_found" | "unexpected";

/** Shown once to the administrator; the password is never stored readable. */
export type TempCredentials = { username: string; password: string };

export type CreateUserResult =
  | ({ ok: true } & TempCredentials)
  | { ok: false; error: CreateUserError; fields: CreateUserField[] };

export type ResetPasswordError = "invalid" | "denied" | "not_found" | "self" | "unexpected";

export type ResetPasswordResult =
  ({ ok: true } & TempCredentials) | { ok: false; error: ResetPasswordError };
