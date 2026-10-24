import { z } from "zod";
import {
  firstParam,
  parseTableParams,
  type SearchParamsRecord,
  type TableParams,
} from "@/lib/data-table/params";

const filtersSchema = z.object({
  type: z.uuid().optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  // Default: current products; "archived": only archived ones.
  view: z.enum(["archived"]).optional().catch(undefined),
});

export type ProductListParams = TableParams & z.infer<typeof filtersSchema>;

export function parseProductListParams(searchParams: SearchParamsRecord): ProductListParams {
  return {
    ...parseTableParams(searchParams),
    ...filtersSchema.parse({
      type: firstParam(searchParams.type) || undefined,
      customer: firstParam(searchParams.customer) || undefined,
      view: firstParam(searchParams.view) || undefined,
    }),
  };
}

export const PRODUCT_TABS = ["basic", "operations", "attachments", "history"] as const;
export type ProductTab = (typeof PRODUCT_TABS)[number];

/** Detail page state: tab and the revision being viewed (default: current). */
export function parseProductDetailParams(searchParams: SearchParamsRecord): {
  tab: ProductTab;
  revisionId: string | null;
} {
  return z
    .object({
      tab: z.enum(PRODUCT_TABS).catch("basic"),
      revisionId: z.uuid().nullable().catch(null),
    })
    .parse({
      tab: firstParam(searchParams.tab) ?? "basic",
      revisionId: firstParam(searchParams.rev) ?? null,
    });
}
