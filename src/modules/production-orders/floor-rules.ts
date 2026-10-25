// Shop-floor rules (pure, unit-tested): where an order's QR code leads and
// how workers search their operations.
import { matchesAllWords } from "@/lib/search";

type FloorOperationRef = { id: string; status: string; mine: boolean; arrived: boolean };

/**
 * Where the order's QR code takes the caller: their open operation that has
 * arrived at the machine (or their only open one); null = show the order.
 */
export function pickMyOperation(operations: readonly FloorOperationRef[]): string | null {
  const open = operations.filter((op) => op.mine && op.status !== "done");
  const arrived = open.filter((op) => op.arrived);
  if (arrived.length === 1) return arrived[0]?.id ?? null;
  if (arrived.length === 0 && open.length === 1) return open[0]?.id ?? null;
  return null;
}

/** Case- and diacritic-insensitive match on order number, part number and name. */
export function matchesFloorSearch(
  item: { orderNumber: string; partNumber: string; productName: string },
  query: string,
): boolean {
  return matchesAllWords(`${item.orderNumber} ${item.partNumber} ${item.productName}`, query);
}
