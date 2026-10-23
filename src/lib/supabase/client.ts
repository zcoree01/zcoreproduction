import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

// Browser client: publishable key only, all access governed by RLS.
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
