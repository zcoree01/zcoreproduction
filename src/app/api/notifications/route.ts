import { NextResponse } from "next/server";
import { getMemberAccess } from "@/lib/auth/access";
import { getCurrentMember } from "@/lib/auth/session";
import { loadNotificationFeed } from "@/modules/notifications/feed";

/**
 * Polled by the notification bell, the "?" button and the support prompt
 * (D-054). A plain GET instead of server actions: the browser runs server
 * actions one at a time, so polling with them made every real action (a
 * status change) wait in the same queue.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  const feed = await loadNotificationFeed(member, await getMemberAccess(member));
  return NextResponse.json(feed, { headers });
}
