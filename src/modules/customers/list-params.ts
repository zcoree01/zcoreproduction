import { z } from "zod";
import {
  firstParam,
  parseTableParams,
  type SearchParamsRecord,
  type TableParams,
} from "@/lib/data-table/params";

const filtersSchema = z.object({
  // Default: current customers; "archived": only archived ones.
  view: z.enum(["archived"]).optional().catch(undefined),
});

export type CustomerListParams = TableParams & z.infer<typeof filtersSchema>;

export function parseCustomerListParams(searchParams: SearchParamsRecord): CustomerListParams {
  return {
    ...parseTableParams(searchParams),
    ...filtersSchema.parse({ view: firstParam(searchParams.view) || undefined }),
  };
}
