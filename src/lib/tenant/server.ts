import "server-only";
import { headers } from "next/headers";
import { orgSlugSchema } from "@/lib/auth/username";
import { TENANT_HEADER } from "./resolve";

// Tenant slug for the current request, as resolved by proxy.ts.
export async function getTenantSlug(): Promise<string | null> {
  const value = (await headers()).get(TENANT_HEADER);
  const parsed = orgSlugSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
