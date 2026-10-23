import { z } from "zod";
import { usernameSchema } from "@/lib/auth/username";

// Shared by the client form (react-hook-form) and the server action.
export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(1).max(200),
  roleId: z.uuid(),
  // bcrypt (Supabase Auth) ignores bytes beyond 72.
  password: z.string().min(8).max(72),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateUserFormValues = z.input<typeof createUserSchema>;

export const CREATE_USER_FIELDS = ["username", "fullName", "roleId", "password"] as const;

export type CreateUserField = (typeof CREATE_USER_FIELDS)[number];

export type CreateUserError =
  "invalid" | "denied" | "username_taken" | "role_not_found" | "unexpected";

export type CreateUserResult =
  { ok: true; username: string } | { ok: false; error: CreateUserError; fields: CreateUserField[] };
