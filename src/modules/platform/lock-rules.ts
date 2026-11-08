// What members of a locked organization may still do in the app (D-049): view
// everything, finish work in progress and ship it, ask for support. Hiding the
// other buttons is UX only; the database (lock_guard) refuses the writes.

const LOCKED_KEEPS: ReadonlySet<string> = new Set([
  "orders.manage",
  "orders.material.update",
  "orders.close.approve",
  "quality.inspect",
  "machines.status.update",
  "inventory.move",
  "finished_goods.manage",
  "support.approve",
]);

/** The member's permissions while the organization is locked. */
export function lockedPermissions(permissions: ReadonlySet<string>): Set<string> {
  return new Set([...permissions].filter((key) => key.endsWith(".read") || LOCKED_KEEPS.has(key)));
}
