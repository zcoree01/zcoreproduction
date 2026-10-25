// Status rules of production orders and their operations. The database
// enforces the same matrix (private.order_transition_allowed and friends in
// migration 20261025100000); this copy decides which buttons are offered.

export const ORDER_STATUSES = [
  "draft",
  "planned",
  "waiting_material",
  "cutting",
  "ready",
  "in_progress",
  "paused",
  "quality_check",
  "completed",
  "cancelled",
  "archived",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["draft", "waiting_material", "cutting", "ready", "cancelled"],
  waiting_material: ["cutting", "ready", "cancelled"],
  cutting: ["waiting_material", "ready", "cancelled"],
  ready: ["waiting_material", "in_progress", "cancelled"],
  in_progress: ["paused", "quality_check", "cancelled"],
  paused: ["in_progress", "cancelled"],
  quality_check: ["in_progress", "completed"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

/** Statuses the warehouse and the cutting worker set. */
export const MATERIAL_STATUSES = ["waiting_material", "cutting", "ready"] as const;
const MATERIAL_SOURCES: readonly OrderStatus[] = ["planned", ...MATERIAL_STATUSES];

/** No more changes, except archiving. */
export const CLOSED_STATUSES: readonly OrderStatus[] = ["completed", "cancelled", "archived"];

/** Orders whose operations appear on the shop floor. */
export const FLOOR_STATUSES: readonly OrderStatus[] = [
  "planned",
  "waiting_material",
  "cutting",
  "ready",
  "in_progress",
  "paused",
  "quality_check",
];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (ORDER_STATUSES as readonly unknown[]).includes(value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isMaterialTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (
    MATERIAL_SOURCES.includes(from) &&
    (MATERIAL_STATUSES as readonly OrderStatus[]).includes(to) &&
    canTransition(from, to)
  );
}

export type StatusActor = {
  /** orders.manage */
  manage: boolean;
  /** orders.material.update, or the worker of a cutting operation of this order. */
  material: boolean;
};

/**
 * Targets the actor may choose from `from`. "completed" is listed for
 * managers but stays blocked until production reporting allows it
 * (see completionBlocked).
 */
export function allowedOrderTargets(from: OrderStatus, actor: StatusActor): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter(
    (to) => actor.manage || (actor.material && isMaterialTransition(from, to)),
  );
}

/**
 * Completing an order needs every operation done with at least the ordered
 * good pieces, or an approved request to close with a shortage. The database
 * computes it (private.order_completion_allowed → completion_allowed).
 */
export function completionBlocked(order: { completionAllowed: boolean }): boolean {
  return !order.completionAllowed;
}

export function requiresReason(to: OrderStatus): boolean {
  return to === "cancelled";
}

/** Quantity, raw piece and bar can change only before material is prepared. */
export function canEditPlanning(status: OrderStatus): boolean {
  return status === "draft" || status === "planned";
}

/** Due date, priority, planned dates and notes: until the order is closed. */
export function canEditSchedule(status: OrderStatus): boolean {
  return !CLOSED_STATUSES.includes(status);
}

/** Operations are added or removed only in drafts. */
export function canChangeRouting(status: OrderStatus): boolean {
  return status === "draft";
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export const OPERATION_STATUSES = ["waiting", "ready", "in_progress", "paused", "done"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const OPERATION_TRANSITIONS: Record<OperationStatus, readonly OperationStatus[]> = {
  waiting: ["ready"],
  ready: ["waiting", "in_progress"],
  in_progress: ["paused", "done"],
  paused: ["in_progress", "done"],
  done: ["in_progress"],
};

export function isOperationStatus(value: unknown): value is OperationStatus {
  return (OPERATION_STATUSES as readonly unknown[]).includes(value);
}

/** Operation statuses change once the order is released and until it is closed. */
export function canChangeOperationStatus(orderStatus: OrderStatus): boolean {
  return orderStatus !== "draft" && !CLOSED_STATUSES.includes(orderStatus);
}
