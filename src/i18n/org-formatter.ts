import "server-only";
import { createFormatter } from "next-intl";
import { getLocale } from "next-intl/server";

/**
 * Server-side formatter in the organization's time zone (D-063).
 *
 * The request config (`src/i18n/request.ts`) cannot read the session: with
 * Cache Components the root layout would turn dynamic. Server components
 * therefore format with this helper instead of `getFormatter()`; client
 * components get the zone from `OrgTimeZoneProvider` in the app / floor shells.
 */
export async function getOrgFormatter(timeZone: string) {
  return createFormatter({ locale: await getLocale(), timeZone });
}
