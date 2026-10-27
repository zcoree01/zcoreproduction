// Countries offered in company and customer forms (ISO 3166-1 alpha-2): the
// region first, then frequent export markets. Names are fixed in Bosnian:
// Intl.DisplayNames gives different results in Node and in browsers, which
// would break hydration.
export const COUNTRY_NAMES = {
  BA: "Bosna i Hercegovina",
  HR: "Hrvatska",
  RS: "Srbija",
  ME: "Crna Gora",
  SI: "Slovenija",
  MK: "Sjeverna Makedonija",
  AL: "Albanija",
  XK: "Kosovo",
  DE: "Njemačka",
  AT: "Austrija",
  CH: "Švicarska",
  IT: "Italija",
  FR: "Francuska",
  NL: "Holandija",
  BE: "Belgija",
  LU: "Luksemburg",
  DK: "Danska",
  SE: "Švedska",
  NO: "Norveška",
  FI: "Finska",
  PL: "Poljska",
  CZ: "Češka",
  SK: "Slovačka",
  HU: "Mađarska",
  RO: "Rumunija",
  BG: "Bugarska",
  GR: "Grčka",
  TR: "Turska",
  ES: "Španija",
  PT: "Portugal",
  IE: "Irska",
  GB: "Ujedinjeno Kraljevstvo",
  US: "Sjedinjene Američke Države",
  CA: "Kanada",
  CN: "Kina",
} as const;

export type CountryCode = keyof typeof COUNTRY_NAMES;

export const COUNTRY_CODES = Object.keys(COUNTRY_NAMES) as [CountryCode, ...CountryCode[]];

export const DEFAULT_COUNTRY: CountryCode = "BA";

/** Bosnian country name for an ISO code; other (old free-text) values unchanged. */
export function countryName(value: string | null | undefined): string | null {
  if (!value) return null;
  return value in COUNTRY_NAMES ? COUNTRY_NAMES[value as CountryCode] : value;
}
