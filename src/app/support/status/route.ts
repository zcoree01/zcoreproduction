import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Polled by the support banner: has this support session ended (D-028)? */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("session_status").maybeSingle();
  const ended = !error && (!data || !data.active || data.support_ended);
  return NextResponse.json({ ended }, { headers: { "cache-control": "no-store" } });
}
