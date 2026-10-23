import { z } from "zod";
import { orgSlugSchema } from "@/lib/auth/username";

export const DEFAULT_TIMEZONE = "Europe/Sarajevo";

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid IANA timezone" },
);

// Settings keys are added as features need them; unknown keys are rejected.
export const orgSettingsSchema = z.object({}).strict();

export const createOrganizationSchema = z.object({
  slug: orgSlugSchema,
  name: z.string().trim().min(1).max(200),
  timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
});

export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;
