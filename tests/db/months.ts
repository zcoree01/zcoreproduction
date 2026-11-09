// Calendar helpers in the test firms' timezone. billing_months works with the
// organization-local day (Europe/Sarajevo), so tests must not use UTC months:
// in the last hours of a month UTC is still in the previous month.

export const TEST_TIMEZONE = "Europe/Sarajevo";

/** Today in Europe/Sarajevo, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TEST_TIMEZONE }).format(now);
}

/** Day `day` of the month `monthsAgo` months before the Sarajevo month of `now`. */
export function localMonthDay(monthsAgo: number, day = 1, now: Date = new Date()): string {
  const [year, month] = localToday(now).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 - monthsAgo, day)).toISOString().slice(0, 10);
}
