import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { slugFromAuthEmail } from "@/lib/auth/username";
import { getPublicEnv } from "@/lib/env";
import { requestHost, resolveTenant, TENANT_COOKIE, TENANT_HEADER } from "@/lib/tenant/resolve";

// Routes reachable without a session for the current tenant.
const PUBLIC_PATHS = new Set(["/login"]);

/**
 * 1. Resolves the tenant (subdomain, or ?org on dev hosts) and forwards it to
 *    server code in TENANT_HEADER (always overwritten, never client-supplied).
 * 2. Refreshes the Supabase session cookies.
 * 3. Redirects to /login unless the session belongs to this tenant.
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
  const supabase = createServerClient(
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

  const path = request.nextUrl.pathname;
  let result = response;
  if (!signedInHere && !PUBLIC_PATHS.has(path)) {
    result = redirectKeepingCookies(request, response, "/login");
  } else if (signedInHere && path === "/login") {
    result = redirectKeepingCookies(request, response, "/");
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

function redirectKeepingCookies(request: NextRequest, from: NextResponse, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = ""; // ?org is persisted in TENANT_COOKIE
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
