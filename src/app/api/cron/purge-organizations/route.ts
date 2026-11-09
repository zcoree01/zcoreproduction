import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCronAuthorized, purgeDueOrganizations } from "@/modules/platform/purge";

// Daily Vercel Cron (vercel.json): permanently deletes firms whose 30-day
// undo has passed (D-049). Vercel sends `Authorization: Bearer <CRON_SECRET>`.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await purgeDueOrganizations(createAdminClient(), new Date());
  if (result.failed.length > 0) console.error("purge-organizations failed", result.failed);
  return NextResponse.json(result, {
    status: result.failed.length > 0 ? 500 : 200,
    headers: { "cache-control": "no-store" },
  });
}
