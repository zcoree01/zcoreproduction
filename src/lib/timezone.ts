// Conversions between UTC instants and wall-clock values in an organization's
// time zone (Intl only, no dependency). Wall-clock values use the formats of
// <input type="date"> ("2026-10-25") and <input type="datetime-local">
// ("2026-10-25T08:00").

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    seconds: get("second"),
  };
}

/** Offset of the zone from UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const { date, time, seconds } = zonedParts(instant, timeZone);
  const asUtc = Date.parse(`${date}T${time}:${seconds}Z`);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Calendar date in the zone ("YYYY-MM-DD"). */
export function zonedDate(instant: Date, timeZone: string): string {
  return zonedParts(instant, timeZone).date;
}

/** datetime-local value of an instant in the zone. */
export function utcToZonedLocal(iso: string, timeZone: string): string {
  const { date, time } = zonedParts(new Date(iso), timeZone);
  return `${date}T${time}`;
}

/**
 * Instant (ISO, UTC) of a wall-clock time in the zone. In the hour skipped by
 * a daylight-saving change the later offset applies.
 */
export function zonedLocalToUtc(local: string, timeZone: string): string {
  const naive = Date.parse(`${local}:00Z`);
  const first = naive - offsetMs(new Date(naive), timeZone);
  const second = naive - offsetMs(new Date(first), timeZone);
  return new Date(second).toISOString();
}
