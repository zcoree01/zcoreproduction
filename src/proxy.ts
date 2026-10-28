import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { decideRoute, SESSION_REPLACED_PARAM } from "@/lib/auth/route-guard";
import { slugFromAuthEmail } from "@/lib/auth/username";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";
import { requestHost, resolveTenant, TENANT_COOKIE, TENANT_HEADER } from "@/lib/tenant/resolve";

/**
 * 1. Resolves the tenant (subdomain, or ?org on dev hosts) and forwards it to
 *    server code in TENANT_HEADER (always overwritten, never client-supplied).
 * 2. Refreshes the Supabase session cookies.
 * 3. Redirects to /login unless the session belongs to this tenant.
 * 4. Signs out a session that was replaced by a sign-in on another device
 *    (one active session per user, D-013).
 * 5. Keeps users with a temporary password on /change-password (D-022).
 *
 * This is a coarse gate only. Pages, server actions and RLS re-check
 * membership and permissions on every request.
 */
export async function proxy(request: NextRequest) {
  const tenant = resolveTenant({
    host: requestHost(request.headers),
    orgParam: request.nextUrl.searchParams.get("org"),
    orgCookie: request.cookies.get(TENANT_COOKIE)?.value ?? null,
  });

  const forward = () => {
    const headers = new Headers(request.headers);
    if (tenant.slug) headers.set(TENANT_HEADER, tenant.slug);
    else headers.delete(TENANT_HEADER);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();
  const env = getPublicEnv();
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = forward();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Validates the JWT and refreshes an expired session. Keep this directly
  // after createServerClient (no awaits in between) per @supabase/ssr guidance.
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === "string" ? data.claims.email : null;
  const signedInHere = tenant.slug !== null && slugFromAuthEmail(email) === tenant.slug;

  const status = signedInHere ? await sessionStatus(supabase) : null;
  const decision = decideRoute({
    path: request.nextUrl.pathname,
    signedInHere,
    sessionActive: status?.active ?? false,
    mustChangePassword: status?.mustChangePassword ?? false,
    supportEnded: status?.supportEnded ?? false,
  });

  let result = response;
  if (decision.action === "sign_out") {
    // Clears this device's session cookies (via setAll above) without calling
    // out to other devices.
    await supabase.auth.signOut({ scope: "local" });
    result = redirectKeepingCookies(request, response, decision.to, SESSION_REPLACED_PARAM);
  } else if (decision.action === "redirect") {
    result = redirectKeepingCookies(request, response, decision.to);
  }

  if (tenant.persist && tenant.slug) {
    result.cookies.set(TENANT_COOKIE, tenant.slug, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return result;
}

/**
 * Whether the JWT's session still exists and whether the user must replace a
 * temporary password. Fails open on infrastructure errors: this enforces the
 * single-session and password-change policies, not authentication (JWT
 * validity, membership and RLS are checked independently).
 */
async function sessionStatus(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc("session_status").maybeSingle();
  if (error || !data) {
    console.error("session_status failed", error);
    return { active: true, mustChangePassword: false, supportEnded: false };
  }
  return {
    active: data.active,
    mustChangePassword: data.must_change_password,
    supportEnded: data.support_ended,
  };
}

function redirectKeepingCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
  param?: { name: string; value: string },
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = ""; // ?org is persisted in TENANT_COOKIE
  if (param) url.searchParams.set(param.name, param.value);
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
