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

/** Zones offered at registration and in Postavke → Organizacija (region of the customers). */
export const ORG_TIMEZONES = [
  "Europe/Sarajevo",
  "Europe/Zagreb",
  "Europe/Belgrade",
  "Europe/Podgorica",
  "Europe/Ljubljana",
  "Europe/Skopje",
  "Europe/Vienna",
  "Europe/Berlin",
  "Europe/London",
] as const;

/** Postavke → Organizacija: any valid IANA zone (the database checks it again). */
export const organizationTimezoneSchema = z.object({ timezone: timezoneSchema }).strict();

export type OrganizationTimezoneInput = z.infer<typeof organizationTimezoneSchema>;

/** The offered zones, plus the current one when it is not among them (set by a script). */
export function timezoneOptions(current: string): string[] {
  const offered: readonly string[] = ORG_TIMEZONES;
  return offered.includes(current) ? [...offered] : [current, ...offered];
}

/** "Sarajevo (GMT+1)": city from the zone id and its offset at `at`. */
export function timezoneLabel(zone: string, at: Date): string {
  const city = (zone.split("/").pop() ?? zone).replaceAll("_", " ");
  // ICU builds differ: "GMT" in some, "GMT+0" in others.
  const offset = (
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  ).replace(/^GMT[+-]0$/, "GMT");
  return offset ? `${city} (${offset})` : city;
}

// Settings keys are added as features need them; unknown keys are rejected.
export const orgSettingsSchema = z.object({}).strict();

export const createOrganizationSchema = z.object({
  slug: orgSlugSchema,
  name: z.string().trim().min(1).max(200),
  timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
});

export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;
