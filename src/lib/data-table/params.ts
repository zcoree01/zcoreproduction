import { z } from "zod";

// URL contract for server-paginated tables: ?page=1&pageSize=25&q=...&<filter>=...
// Invalid values fall back to defaults instead of erroring (URLs are user input).

export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const baseSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((size) => (PAGE_SIZES as readonly number[]).includes(size))
    .catch(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(100).catch(""),
});

export type TableParams = z.infer<typeof baseSchema>;

export function parseTableParams(searchParams: SearchParamsRecord): TableParams {
  return baseSchema.parse({
    page: firstParam(searchParams.page) ?? 1,
    pageSize: firstParam(searchParams.pageSize) ?? DEFAULT_PAGE_SIZE,
    q: firstParam(searchParams.q) ?? "",
  });
}

/** Inclusive row range for PostgREST `.range(from, to)`. */
export function pageRange({ page, pageSize }: Pick<TableParams, "page" | "pageSize">) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/**
 * ILIKE pattern for free-text search, or null when nothing searchable is left.
 * Keeps letters (incl. č ć đ š ž), digits, space, dot, dash and underscore, so
 * the value cannot break PostgREST filter syntax (commas, parentheses) or act
 * as a wildcard (%, _ are escaped by removal of % and literal handling of _).
 */
export function toSearchPattern(query: string): string | null {
  const cleaned = query
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  if (!cleaned) return null;
  return `%${cleaned.replaceAll("_", "\\_")}%`;
}
