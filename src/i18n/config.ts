export const locales = ["bs"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "bs";

// Fallback only. The real value comes from organization settings once tenants exist.
export const defaultTimeZone = "Europe/Sarajevo";
