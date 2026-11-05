/** A role's permission together with the module it belongs to. */
export type PermissionRow = { permission_key: string; module_key: string | null };

/**
 * Permissions that count for the organization: a permission works only while
 * its module is enabled (D-049, same rule as private.has_permission).
 */
export function effectivePermissions(
  rows: readonly PermissionRow[],
  modules: ReadonlySet<string>,
): Set<string> {
  return new Set(
    rows
      .filter((row) => row.module_key !== null && modules.has(row.module_key))
      .map((row) => row.permission_key),
  );
}
