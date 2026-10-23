import { z } from "zod";
import {
  firstParam,
  parseTableParams,
  type SearchParamsRecord,
  type TableParams,
} from "@/lib/data-table/params";

const filtersSchema = z.object({
  role: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,62}$/)
    .optional()
    .catch(undefined),
  status: z.enum(["active", "inactive"]).optional().catch(undefined),
});

export type MemberListParams = TableParams & z.infer<typeof filtersSchema>;

export function parseMemberListParams(searchParams: SearchParamsRecord): MemberListParams {
  return {
    ...parseTableParams(searchParams),
    ...filtersSchema.parse({
      role: firstParam(searchParams.role) || undefined,
      status: firstParam(searchParams.status) || undefined,
    }),
  };
}
