import { z } from "zod";
import {
  firstParam,
  parseTableParams,
  type SearchParamsRecord,
  type TableParams,
} from "@/lib/data-table/params";
import { ORDER_STATUSES } from "./status-rules";

export const DUE_FILTERS = ["warning", "overdue", "behind", "due_soon"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

const filtersSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional().catch(undefined),
  priority: z.enum(["1", "2", "3", "4", "5"]).optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  machine: z.uuid().optional().catch(undefined),
  due: z.enum(DUE_FILTERS).optional().catch(undefined),
});

export type OrderListParams = TableParams & z.infer<typeof filtersSchema>;

export function parseOrderListParams(searchParams: SearchParamsRecord): OrderListParams {
  return {
    ...parseTableParams(searchParams),
    ...filtersSchema.parse({
      status: firstParam(searchParams.status) || undefined,
      priority: firstParam(searchParams.priority) || undefined,
      customer: firstParam(searchParams.customer) || undefined,
      machine: firstParam(searchParams.machine) || undefined,
      due: firstParam(searchParams.due) || undefined,
    }),
  };
}

export const ORDER_TABS = [
  "overview",
  "operations",
  "production",
  "attachments",
  "history",
] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export function parseOrderTab(searchParams: SearchParamsRecord): OrderTab {
  return z
    .enum(ORDER_TABS)
    .catch("overview")
    .parse(firstParam(searchParams.tab) ?? "overview");
}
