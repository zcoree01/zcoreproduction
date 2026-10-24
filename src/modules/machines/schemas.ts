import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalText, optionalUuid, requiredText } from "@/lib/forms";

// Must match the CHECK on public.machines.status.
export const MACHINE_STATUSES = [
  "available",
  "running",
  "stopped",
  "maintenance",
  "inactive",
] as const;

export type MachineStatus = (typeof MACHINE_STATUSES)[number];

export const machineStatusSchema = z.enum(MACHINE_STATUSES);

// Shared by the client form (react-hook-form) and the server action.
export const machineSchema = z.object({
  code: requiredText(50),
  name: requiredText(200),
  typeId: optionalUuid,
  manufacturer: optionalText(100),
  model: optionalText(100),
  locationId: optionalUuid,
  status: machineStatusSchema,
  notes: optionalText(2000),
  // "" = organization default (Postavke proizvodnje).
  cycleTimeUnit: z.enum(["", "min", "s"]).transform((value) => value || null),
});

export type MachineInput = z.infer<typeof machineSchema>;
export type MachineFormValues = z.input<typeof machineSchema>;

export const MACHINE_FIELDS = [
  "code",
  "name",
  "typeId",
  "manufacturer",
  "model",
  "locationId",
  "status",
  "notes",
  "cycleTimeUnit",
] as const;

export type MachineField = (typeof MACHINE_FIELDS)[number];

export type MachineActionResult = ActionResult<MachineField, "code_taken" | "invalid_reference">;

/** Row shape for public.machines inserts/updates (organization_id added by the caller). */
export function toMachineRow(input: MachineInput) {
  return {
    code: input.code,
    name: input.name,
    type_id: input.typeId,
    manufacturer: input.manufacturer,
    model: input.model,
    location_id: input.locationId,
    status: input.status,
    notes: input.notes,
    cycle_time_unit: input.cycleTimeUnit,
  };
}
