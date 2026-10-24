import { z } from "zod";
import { compareDecimals, parseDecimal } from "./decimal";

// Form-friendly Zod helpers: HTML inputs and selects always produce strings,
// "" meaning "nothing selected / left empty". Shared by client forms and
// server actions, so both normalise values identically.

/** Optional select of a referenced row: "" → null, otherwise a uuid. */
export const optionalUuid = z.union([z.literal(""), z.uuid()]).transform((value) => value || null);

/** Optional free text: trimmed, "" → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

/** Required free text: trimmed, 1..max characters. */
export const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * Optional decimal input ("12,5" or "12.5"): "" → null, otherwise a canonical
 * decimal string (see lib/decimal) within [min, max]; `exclusiveMin` for > min.
 */
export const optionalDecimal = (options: {
  maxScale: number;
  max: string;
  min?: string;
  exclusiveMin?: boolean;
}) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const parsed = parseDecimal(value, options.maxScale);
      const min = options.min ?? "0";
      const belowMin =
        parsed !== null &&
        (options.exclusiveMin
          ? compareDecimals(parsed, min) <= 0
          : compareDecimals(parsed, min) < 0);
      if (parsed === null || belowMin || compareDecimals(parsed, options.max) > 0) {
        ctx.addIssue({ code: "custom", message: "invalid decimal" });
        return z.NEVER;
      }
      return parsed;
    });

/** Every item occurs once (ids in multi-selects). */
export const isUnique = <T>(items: readonly T[]) => new Set(items).size === items.length;
