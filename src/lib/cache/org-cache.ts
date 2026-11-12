import "server-only";
import { updateTag } from "next/cache";
import { getMemberAccess } from "@/lib/auth/access";
import { getSessionContext } from "@/lib/auth/session";

/**
 * Server cache for an organization's lists that change rarely (D-062): pickers
 * and filters (catalogs, materials, operation types, customers, machines,
 * stock locations and items). Entries live in Vercel's Runtime Cache ('use
 * cache: remote', shared by all function instances; in memory locally), one
 * per organization, tagged with the organization.
 *
 * The cached loaders read with the service role, so they bypass RLS. They are
 * reached only through orgCacheAllowed, which grants exactly what the table's
 * RLS select policy grants; whoever is not allowed reads through RLS as before.
 */
export type OrgCacheKind =
  | "catalogs"
  | "materials"
  | "operation_types"
  | "customers"
  | "machines"
  | "stock_locations"
  | "stock_items";

export function orgCacheTag(organizationId: string, kind: OrgCacheKind): string {
  return `org:${organizationId}:${kind}`;
}

/**
 * The key carries the lists' versions (org_cache_versions: every write to the
 * tables bumps them, wherever it comes from), so an entry is never older than
 * the data. The lifetime only frees memory.
 */
export const ORG_CACHE_LIFE = { stale: 30, revalidate: 900, expire: 3600 } as const;

/**
 * Server actions only: the render that follows the action (same request, so
 * the versions read at its start) reads the changed lists fresh.
 */
export function expireOrgCache(organizationId: string, ...kinds: OrgCacheKind[]): void {
  for (const kind of kinds) updateTag(orgCacheTag(organizationId, kind));
}

/**
 * The cache key part for `organizationId`'s lists `kinds`, or null when the
 * signed-in member may not read them from the cache: the same conditions as
 * private.user_org_ids (active membership, organization and profile not
 * archived, support time running) and, unless `anyOf` is "member", one of the
 * permissions of the table's RLS policy, counted only while its module is
 * enabled (private.permitted_org_ids). Null whenever in doubt: the caller then
 * reads through RLS.
 */
export async function orgCacheVersion(
  organizationId: string,
  anyOf: "member" | readonly string[],
  kinds: readonly OrgCacheKind[],
): Promise<string | null> {
  const context = await getSessionContext();
  if (!context || !context.active || !context.cacheVersions) return null;
  if (!context.session.active || context.session.supportEnded) return null;
  if (context.member.organization.id !== organizationId) return null;
  if (anyOf !== "member") {
    const access = await getMemberAccess(context.member);
    if (!anyOf.some((permission) => access.permissions.has(permission))) return null;
  }
  const versions = context.cacheVersions;
  return kinds.map((kind) => `${kind}:${versions[kind] ?? 0}`).join(",");
}

/** Whether the signed-in member holds `permission` (for columns RLS hides). */
export async function memberHolds(permission: string): Promise<boolean> {
  const context = await getSessionContext();
  if (!context) return false;
  return (await getMemberAccess(context.member)).permissions.has(permission);
}
