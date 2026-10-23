import { getRequestConfig } from "next-intl/server";
import { defaultLocale, defaultTimeZone } from "./config";

// Single-locale setup (no locale in the URL). Adding a language later means
// adding messages/<locale>.json and resolving the locale here.
export default getRequestConfig(async () => ({
  locale: defaultLocale,
  timeZone: defaultTimeZone,
  messages: (await import(`../../messages/${defaultLocale}.json`)).default,
}));
