import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requestHost, ROOT_DOMAIN } from "@/lib/tenant/resolve";
import { platformReturnUrl, SUPPORT_RETURN_COOKIE } from "@/modules/support/schemas";

/**
 * End of a support session in this browser (D-028): signs the support account
 * out and returns the platform admin to their own Zcore session with a notice.
 * In production the Zcore session lives on its own subdomain and was never
 * touched; on a single host it is restored from the kept refresh token.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });

  const cookieStore = await cookies();
  const returnToken = cookieStore.get(SUPPORT_RETURN_COOKIE)?.value;
  cookieStore.delete(SUPPORT_RETURN_COOKIE);

  const host = requestHost(request.headers) ?? request.nextUrl.host;
  const protocol = request.nextUrl.protocol;
  const target = new URL(platformReturnUrl({ protocol, host, rootDomain: ROOT_DOMAIN }));

  if (target.host === host) {
    const restored = returnToken
      ? await supabase.auth.refreshSession({ refresh_token: returnToken })
      : null;
    if (!restored || restored.error || !restored.data.session) {
      // The Zcore session could not be restored: sign in again.
      target.pathname = "/login";
    }
  }
  return NextResponse.redirect(target);
}
