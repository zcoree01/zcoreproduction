import { z } from "zod";

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

/** Every item occurs once (ids in multi-selects). */
export const isUnique = <T>(items: readonly T[]) => new Set(items).size === items.length;
