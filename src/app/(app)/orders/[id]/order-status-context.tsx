"use client";

import { createContext, useContext, useOptimistic, type ReactNode } from "react";
import { OrderStatusBadge } from "@/components/shared/order-badges";
import type { OrderStatus } from "@/modules/production-orders/status-rules";

type ShownStatus = { status: OrderStatus; show: (status: OrderStatus) => void };

const OrderStatusContext = createContext<ShownStatus | null>(null);

/**
 * The order's status as shown in the header: a change appears at once and is
 * replaced by the server's answer when the action returns (or rolled back on
 * an error). Display only; the database decides every transition.
 */
export function OrderStatusProvider({
  status,
  children,
}: {
  status: OrderStatus;
  children: ReactNode;
}) {
  const [shown, show] = useOptimistic(status);
  return <OrderStatusContext value={{ status: shown, show }}>{children}</OrderStatusContext>;
}

/** Call inside the transition that runs the status action. */
export function useShowOrderStatus(): (status: OrderStatus) => void {
  return useContext(OrderStatusContext)?.show ?? noop;
}

export function ShownOrderStatusBadge({
  status,
  closeRequested,
}: {
  status: OrderStatus;
  closeRequested: boolean;
}) {
  const shown = useContext(OrderStatusContext)?.status ?? status;
  return <OrderStatusBadge status={shown} closeRequested={closeRequested && shown === status} />;
}

function noop() {}
