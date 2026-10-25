// Two-letter initials for avatars: first + last word, or first two letters.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const letters =
    parts.length > 1 ? [parts[0]?.[0], parts.at(-1)?.[0]] : [parts[0]?.[0], parts[0]?.[1]];
  return letters.filter(Boolean).join("").toLocaleUpperCase("bs");
}

/**
 * Calendar date "2026-10-29" as "29.10.2026." — fixed format without Intl,
 * so server and browser render the same text (client components).
 */
export function formatDay(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)}.${Number(month)}.${year}.`;
}

/** datetime-local value "2026-10-29T08:05" as "29.10. 08:05" (see formatDay). */
export function formatLocalDateTime(local: string): string {
  const [date = "", time = ""] = local.split("T");
  const [, month, day] = date.split("-");
  return `${Number(day)}.${Number(month)}. ${time.slice(0, 5)}`;
}
