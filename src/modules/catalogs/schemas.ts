import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import type { PermissionKey } from "@/lib/auth/permissions";
import { requiredText } from "@/lib/forms";

// Per-organization lists. Must match the CHECK on public.catalog_items.kind.
export const CATALOG_KINDS = [
  "machine_type",
  "location",
  "department",
  "job_title",
  "skill",
  "product_type",
  "downtime_reason",
  "scrap_reason",
  "tool_change_reason",
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const catalogKindSchema = z.enum(CATALOG_KINDS);

// Mirrors private.catalog_manage_permission() (used by RLS).
export const CATALOG_MANAGE_PERMISSION: Record<CatalogKind, PermissionKey> = {
  machine_type: "machines.manage",
  location: "machines.manage",
  department: "employees.manage",
  job_title: "employees.manage",
  skill: "employees.manage",
  product_type: "products.manage",
  downtime_reason: "orders.manage",
  scrap_reason: "orders.manage",
  tool_change_reason: "orders.manage",
};

/** Catalog kinds the holder of `permissions` may manage, in display order. */
export function manageableCatalogKinds(permissions: ReadonlySet<string>): CatalogKind[] {
  return CATALOG_KINDS.filter((kind) => permissions.has(CATALOG_MANAGE_PERMISSION[kind]));
}

export const catalogItemNameSchema = z.object({ name: requiredText(100) });

export type CatalogItemFormValues = z.input<typeof catalogItemNameSchema>;

export type CatalogItemField = "name";
export type CatalogActionResult = ActionResult<CatalogItemField, "name_taken">;
