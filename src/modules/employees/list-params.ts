import { z } from "zod";
import {
  firstParam,
  parseTableParams,
  type SearchParamsRecord,
  type TableParams,
} from "@/lib/data-table/params";
import { EMPLOYEE_STATUSES } from "./schemas";

const filtersSchema = z.object({
  department: z.uuid().optional().catch(undefined),
  skill: z.uuid().optional().catch(undefined),
  status: z.enum(EMPLOYEE_STATUSES).optional().catch(undefined),
  // Default: current employees; "archived": only archived ones.
  view: z.enum(["archived"]).optional().catch(undefined),
});

export type EmployeeListParams = TableParams & z.infer<typeof filtersSchema>;

export function parseEmployeeListParams(searchParams: SearchParamsRecord): EmployeeListParams {
  return {
    ...parseTableParams(searchParams),
    ...filtersSchema.parse({
      department: firstParam(searchParams.department) || undefined,
      skill: firstParam(searchParams.skill) || undefined,
      status: firstParam(searchParams.status) || undefined,
      view: firstParam(searchParams.view) || undefined,
    }),
  };
}
