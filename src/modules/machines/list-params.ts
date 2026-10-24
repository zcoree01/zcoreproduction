import { z } from "zod";
import {
  firstParam,
  parseTableParams,
  type SearchParamsRecord,
  type TableParams,
} from "@/lib/data-table/params";
import { MACHINE_STATUSES } from "./schemas";

const filtersSchema = z.object({
  status: z.enum(MACHINE_STATUSES).optional().catch(undefined),
  type: z.uuid().optional().catch(undefined),
  location: z.uuid().optional().catch(undefined),
  // Default: current machines; "archived": only archived ones.
  view: z.enum(["archived"]).optional().catch(undefined),
});

export type MachineListParams = TableParams & z.infer<typeof filtersSchema>;

export function parseMachineListParams(searchParams: SearchParamsRecord): MachineListParams {
  return {
    ...parseTableParams(searchParams),
    ...filtersSchema.parse({
      status: firstParam(searchParams.status) || undefined,
      type: firstParam(searchParams.type) || undefined,
      location: firstParam(searchParams.location) || undefined,
      view: firstParam(searchParams.view) || undefined,
    }),
  };
}
