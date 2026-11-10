import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Records that the member used the app today (one row per firm, user and day in
 * the firm's time zone; the database ignores the Zcore organization and
 * support accounts). Runs after the response is sent; a failure is logged and
 * never breaks the page. The client is created now because request cookies
 * cannot be read inside after().
 */
export async function recordMemberActivityAfterResponse(organizationId: string): Promise<void> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (error) {
    console.error("member activity client failed", error);
    return;
  }
  after(async () => {
    try {
      const { error } = await supabase.rpc("record_member_activity", { p_org: organizationId });
      if (error) console.error("record_member_activity failed", error);
    } catch (error) {
      console.error("record_member_activity failed", error);
    }
  });
}
