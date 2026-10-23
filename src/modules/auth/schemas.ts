import { z } from "zod";
import { usernameSchema } from "@/lib/auth/username";

export const signInSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(200),
});

export const SIGN_IN_ERRORS = [
  "invalid_credentials",
  "inactive",
  "no_tenant",
  "rate_limited",
] as const;

export type SignInError = (typeof SIGN_IN_ERRORS)[number];

export type SignInState = { error: SignInError | null; username?: string };
