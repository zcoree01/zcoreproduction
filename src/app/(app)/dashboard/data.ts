import "server-only";
import { cache } from "react";
import { zonedDate } from "@/lib/timezone";
import { listPendingRequests } from "@/modules/attendance/absence-queries";
import { getAttendanceBoard } from "@/modules/attendance/queries";
import { lastDays } from "@/modules/dashboard/stats";
import { listOpenOrders } from "@/modules/production-orders/queries";
import { getProductionDay, getProductionPeriod } from "@/modules/production-reporting/day";
import { listStockItems } from "@/modules/inventory/queries";

// Loaders shared by several widgets, once per request.

export const PERIOD_DAYS = 30;

export const today = (timeZone: string) => zonedDate(new Date(), timeZone);

export const loadOpenOrders = cache((organizationId: string) => listOpenOrders(organizationId));

export const loadProductionToday = cache((organizationId: string, timeZone: string) =>
  getProductionDay(organizationId, today(timeZone), timeZone),
);

/** Reports and downtime of the last 30 days (today included). */
export const loadProductionPeriod = cache((organizationId: string, timeZone: string) => {
  const days = lastDays(today(timeZone), PERIOD_DAYS);
  return getProductionPeriod(organizationId, days[0] ?? today(timeZone), today(timeZone), timeZone);
});

export const loadAttendanceToday = cache((organizationId: string, timeZone: string) =>
  getAttendanceBoard(organizationId, today(timeZone)),
);

export const loadPendingRequests = cache((organizationId: string) =>
  listPendingRequests(organizationId),
);

export const loadStockItems = cache((organizationId: string) => listStockItems(organizationId));
