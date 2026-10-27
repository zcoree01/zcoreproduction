import { NextResponse, type NextRequest } from "next/server";
import { slugFromAuthEmail } from "@/lib/auth/username";
import { createClient } from "@/lib/supabase/server";
import { getTenantSlug } from "@/lib/tenant/server";

/**
 * Redeems the one-time token issued by enterSupportAction (D-026): signs this
 * browser in as the organization's support account and opens the app. The
 * token is valid once and only for the organization of this address.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const toLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  };
  if (!tokenHash) return toLogin();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  const tenantSlug = await getTenantSlug();
  if (error || !data.user || slugFromAuthEmail(data.user.email) !== tenantSlug) {
    if (!error) await supabase.auth.signOut({ scope: "local" });
    return toLogin();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  return NextResponse.redirect(url);
}
