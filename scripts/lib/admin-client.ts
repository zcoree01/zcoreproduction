import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/types";

// Service-role client for trusted Node contexts (seed scripts, DB tests).
// Lives outside src/ so app code cannot import it.
const adminEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function readAdminEnv(env: NodeJS.ProcessEnv = process.env) {
  return adminEnvSchema.parse(env);
}

export function createAdminClient(env = readAdminEnv()) {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
