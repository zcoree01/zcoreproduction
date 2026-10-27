import { z } from "zod";

// Shared by the client forms (react-hook-form) and the server actions.

// bcrypt (Supabase Auth) ignores bytes beyond 72.
export const MIN_PASSWORD = 8;
export const newPasswordSchema = z.string().min(MIN_PASSWORD).max(72);

// Refinement messages are codes ("username", "same"); the forms translate them.

/** The new password must not simply be the username. */
function notUsername(username: string) {
  return (password: string) => password.trim().toLowerCase() !== username.toLowerCase();
}

/** First sign-in with a temporary password: choose a new one. */
export function initialPasswordSchema(username: string) {
  return z
    .object({ newPassword: newPasswordSchema, confirmPassword: z.string().max(72) })
    .refine((v) => notUsername(username)(v.newPassword), {
      path: ["newPassword"],
      message: "username",
    })
    .refine((v) => v.confirmPassword === v.newPassword, { path: ["confirmPassword"] });
}

/** Profile page: the current password is required. */
export function changePasswordSchema(username: string) {
  return z
    .object({
      currentPassword: z.string().min(1).max(72),
      newPassword: newPasswordSchema,
      confirmPassword: z.string().max(72),
    })
    .refine((v) => notUsername(username)(v.newPassword), {
      path: ["newPassword"],
      message: "username",
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
      path: ["newPassword"],
      message: "same",
    })
    .refine((v) => v.confirmPassword === v.newPassword, { path: ["confirmPassword"] });
}

export type InitialPasswordValues = z.input<ReturnType<typeof initialPasswordSchema>>;
export type ChangePasswordValues = z.input<ReturnType<typeof changePasswordSchema>>;

export const PASSWORD_FIELDS = ["currentPassword", "newPassword", "confirmPassword"] as const;
export type PasswordField = (typeof PASSWORD_FIELDS)[number];

export type PasswordError =
  | "invalid"
  | "denied"
  | "wrong_current"
  | "same_password"
  | "weak_password"
  | "rate_limited"
  | "unexpected";

export type PasswordResult =
  { ok: true } | { ok: false; error: PasswordError; fields: PasswordField[] };

/** 0 = too short … 3 = strong; only a hint for the user, never a rule. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (password.length < MIN_PASSWORD) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((re) => re.test(password)).length;
  const score = (password.length >= 12 ? 1 : 0) + (kinds >= 2 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  return Math.max(1, Math.min(3, score)) as 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// Display preferences (profiles.preferences)
// ---------------------------------------------------------------------------
export const TEXT_SIZES = ["normal", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const preferencesSchema = z.object({ textSize: z.enum(TEXT_SIZES) });
export type ProfilePreferences = z.infer<typeof preferencesSchema>;

const storedPreferencesSchema = z.object({
  text_size: z.enum(TEXT_SIZES).catch("normal").default("normal"),
});

/** Stored JSON → preferences; unknown or broken values fall back to defaults. */
export function parsePreferences(value: unknown): ProfilePreferences {
  const parsed = storedPreferencesSchema.safeParse(value);
  return { textSize: parsed.success ? parsed.data.text_size : "normal" };
}
