import type { MachineStatus } from "./schemas";

// Statuses an operator may set from the shop floor. 'inactive' (machine taken
// out of use) is a management decision. Enforced by public.set_machine_status;
// mirrored here so the floor UI offers only allowed choices.
export const OPERATOR_STATUSES = [
  "available",
  "running",
  "stopped",
  "maintenance",
] as const satisfies readonly MachineStatus[];

export type StatusActor = "manager" | "operator";

export function allowedStatusTargets(
  actor: StatusActor,
  current: MachineStatus,
): readonly MachineStatus[] {
  if (actor === "manager") {
    return ["available", "running", "stopped", "maintenance", "inactive"];
  }
  return current === "inactive" ? [] : OPERATOR_STATUSES;
}

export function canSetStatus(
  actor: StatusActor,
  current: MachineStatus,
  next: MachineStatus,
): boolean {
  return next !== current && allowedStatusTargets(actor, current).includes(next);
}
