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

/** Status filter value for orders whose closing with a shortage waits for approval. */
export const CLOSE_REQUESTED = "close_requested";
export const ORDER_STATUS_FILTERS = [...ORDER_STATUSES, CLOSE_REQUESTED] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

const statusFilter = z.enum(ORDER_STATUS_FILTERS).optional().catch(undefined);
const priorityFilter = z.enum(["1", "2", "3", "4", "5"]).optional().catch(undefined);

const filtersSchema = z.object({
  status: statusFilter,
  priority: priorityFilter,
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

const customerOrderFiltersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  priority: priorityFilter,
  status: statusFilter,
});
export type CustomerOrderFilters = z.infer<typeof customerOrderFiltersSchema>;

/** Filters of the orders on a customer's page (?q=&priority=&status=). */
export function parseCustomerOrderFilters(searchParams: SearchParamsRecord): CustomerOrderFilters {
  return customerOrderFiltersSchema.parse({
    q: firstParam(searchParams.q) ?? "",
    priority: firstParam(searchParams.priority) || undefined,
    status: firstParam(searchParams.status) || undefined,
  });
}
