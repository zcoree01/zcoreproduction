import { z } from "zod";
import { usernameSchema } from "@/lib/auth/username";

// Client form validation (react-hook-form). Messages are mapped to i18n keys.
export const signInFormSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export type SignInFormValues = z.input<typeof signInFormSchema>;

// Server-side validation: also enforces the username format.
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

// On success the action redirects and never returns.
export type SignInResult = { error: SignInError };
