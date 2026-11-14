import { z } from "zod";
import {
  firstParam,
  parseTableParams,
  type SearchParamsRecord,
  type TableParams,
} from "@/lib/data-table/params";

const filtersSchema = z.object({
  // Default: all delivery notes; otherwise only issued or only cancelled ones.
  status: z.enum(["issued", "cancelled"]).optional().catch(undefined),
});

export type DeliveryNoteListParams = TableParams & z.infer<typeof filtersSchema>;

export function parseDeliveryNoteListParams(
  searchParams: SearchParamsRecord,
): DeliveryNoteListParams {
  return {
    ...parseTableParams(searchParams),
    ...filtersSchema.parse({ status: firstParam(searchParams.status) || undefined }),
  };
}
