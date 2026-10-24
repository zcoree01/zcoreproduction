// Exact decimal arithmetic on strings (no floats), for quantities, dimensions
// and times that are stored as Postgres `numeric`. Values travel as canonical
// strings: optional "-", digits, optional "." + digits, no trailing zeros.

const INPUT_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Canonical decimal string from user input ("12,50" → "12.5"), or null when
 * the input is not a plain decimal or has more than `maxScale` decimals.
 */
export function parseDecimal(input: string, maxScale: number): string | null {
  const compact = input.replace(/\s+/g, "");
  if (!INPUT_PATTERN.test(compact)) return null;
  const [whole = "0", fraction = ""] = compact.replace(",", ".").split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  if (trimmedFraction.length > maxScale) return null;
  return fromScaled(toScaled(`${whole}.${trimmedFraction}`, maxScale), maxScale);
}

/** Integer value of `decimal` × 10^scale (truncates extra decimals). */
export function toScaled(decimal: string, scale: number): bigint {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  const digits = `${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`;
  const value = BigInt(digits === "" ? "0" : digits);
  return negative ? -value : value;
}

/** Canonical decimal string of value / 10^scale. */
export function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? digits.slice(digits.length - scale).replace(/0+$/, "") : "";
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== "0" ? `-${text}` : text;
}

/** Rounds value / divisor half away from zero. */
function divideRounded(value: bigint, divisor: bigint): bigint {
  const negative = value < 0n !== divisor < 0n;
  const a = value < 0n ? -value : value;
  const b = divisor < 0n ? -divisor : divisor;
  const quotient = (a * 2n + b) / (b * 2n);
  return negative ? -quotient : quotient;
}

/** decimal × factor (exact). */
export function multiplyDecimal(decimal: string, factor: string, scale = 6): string {
  const product = toScaled(decimal, scale) * toScaled(factor, scale);
  return fromScaled(divideRounded(product, 10n ** BigInt(scale)), scale);
}

/** decimal / divisor, rounded to `scale` decimals. */
export function divideDecimal(decimal: string, divisor: string, scale: number): string {
  const precision = scale + 6;
  const numerator = toScaled(decimal, precision) * 10n ** BigInt(scale);
  return fromScaled(divideRounded(numerator, toScaled(divisor, precision)), scale);
}

export function addDecimals(values: readonly string[], scale = 6): string {
  return fromScaled(
    values.reduce((sum, value) => sum + toScaled(value, scale), 0n),
    scale,
  );
}

export function compareDecimals(a: string, b: string, scale = 6): -1 | 0 | 1 {
  const diff = toScaled(a, scale) - toScaled(b, scale);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/** Display form with a decimal comma (bs), e.g. "12.5" → "12,5". */
export function formatDecimal(decimal: string | null | undefined): string {
  return decimal == null ? "" : decimal.replace(".", ",");
}

/**
 * Canonical string of a numeric value read from the database. PostgREST
 * returns numeric as JSON numbers; their decimal text is converted directly.
 */
export function decimalFromDb(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? numberToPlainString(value) : value;
  return parseDecimal(text, 12);
}

function numberToPlainString(value: number): string {
  const text = String(value);
  if (!/e/i.test(text)) return text;
  // Exponent notation only for very small/large numbers; numeric(…,3/4) never needs more.
  return value.toFixed(12);
}
