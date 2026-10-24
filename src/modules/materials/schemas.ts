import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { optionalDecimal, requiredText } from "@/lib/forms";
import { foldText, matchesAllWords } from "@/lib/search";

/** Density in kg/dm³ (= g/cm³), up to 4 decimals. */
const density = optionalDecimal({ maxScale: 4, max: "30", exclusiveMin: true });

export const materialGroupSchema = z.object({
  name: requiredText(100),
  density,
});
export type MaterialGroupFormValues = z.input<typeof materialGroupSchema>;
export const MATERIAL_GROUP_FIELDS = ["name", "density"] as const;
export type MaterialGroupField = (typeof MATERIAL_GROUP_FIELDS)[number];
export type MaterialGroupActionResult = ActionResult<MaterialGroupField, "name_taken">;

export const materialSchema = z.object({
  groupId: z.uuid(),
  designation: requiredText(100),
  density,
});
export type MaterialFormValues = z.input<typeof materialSchema>;
export const MATERIAL_FIELDS = ["groupId", "designation", "density"] as const;
export type MaterialField = (typeof MATERIAL_FIELDS)[number];
export type MaterialActionResult = ActionResult<MaterialField, "designation_taken">;

export type MaterialOption = {
  id: string;
  designation: string;
  groupName: string;
  /** Own density or the group's (kg/dm³). */
  density: string | null;
};

/**
 * Options whose designation or group contain every typed word ("inox 304",
 * "alu 6082"); matches on the designation alone come first.
 */
export function filterMaterialOptions<T extends Pick<MaterialOption, "designation" | "groupName">>(
  options: readonly T[],
  query: string,
): T[] {
  if (foldText(query).trim() === "") return [...options];
  return options
    .filter((option) => matchesAllWords(`${option.designation} ${option.groupName}`, query))
    .map((option) => ({ option, rank: matchesAllWords(option.designation, query) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.option);
}
