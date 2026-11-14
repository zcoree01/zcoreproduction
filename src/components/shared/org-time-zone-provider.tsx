"use client";

import { NextIntlClientProvider, useLocale } from "next-intl";
import type { ReactNode } from "react";

/**
 * Client components below format dates in the organization's time zone (D-063).
 * Messages and formats are inherited from the root provider, not sent again.
 */
export function OrgTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: ReactNode;
}) {
  const locale = useLocale();
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
