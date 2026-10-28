import { orgSlugSchema } from "@/lib/auth/username";

export const ROOT_DOMAIN = "zcore.ba";

// Request header set by proxy.ts for server code. Always overwritten there,
// so a client cannot inject it.
export const TENANT_HEADER = "x-zcore-tenant";

// Dev/preview only: remembers ?org=<slug> across navigations.
export const TENANT_COOKIE = "zcore_tenant";

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "auth", "static"]);

export type TenantResolution = {
  slug: string | null;
  source: "subdomain" | "query" | "cookie" | null;
  /** True when the slug came from ?org and should be stored in TENANT_COOKIE. */
  persist: boolean;
};

const NONE: TenantResolution = { slug: null, source: null, persist: false };

/**
 * Host the browser used. Prefers x-forwarded-host: Next.js renders a server
 * action's redirect() through an internal fetch to its own origin (Host:
 * localhost), forwarding the original host only in x-forwarded-host. On Vercel
 * the platform sets this header. A spoofed value can only change which login
 * screen is shown; access is decided by the session's tenant + membership + RLS.
 */
export function requestHost(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || headers.get("host");
}

function hostnameOf(host: string): string {
  const lower = host.trim().toLowerCase();
  if (lower.startsWith("[")) return lower.slice(0, lower.indexOf("]") + 1); // IPv6
  return lower.split(":")[0] ?? "";
}

function validSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = orgSlugSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function subdomainSlug(hostname: string, parentDomain: string): string | null {
  if (!hostname.endsWith(`.${parentDomain}`)) return null;
  const label = hostname.slice(0, -(parentDomain.length + 1));
  if (label.includes(".") || RESERVED_SUBDOMAINS.has(label)) return null;
  return validSlug(label);
}

/** IPv4 address of a private network (10/8, 172.16/12, 192.168/16). */
export function isPrivateNetworkHost(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// The dev server opened from another device on the local network (a phone or
// the kiosk tablet at http://192.168.x.x:3000) has no tenant subdomain either.
function developmentLanHost(hostname: string): boolean {
  return process.env.NODE_ENV === "development" && isPrivateNetworkHost(hostname);
}

// Hosts where ?org=<slug> may select the tenant (no per-tenant subdomain available).
function allowsOrgOverride(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".vercel.app") ||
    developmentLanHost(hostname)
  );
}

/**
 * Tenant = subdomain (`<slug>.zcore.ba`, `<slug>.localhost`). On localhost,
 * Vercel preview hosts and (development only) local-network IP addresses,
 * `?org=<slug>` (then the remembered cookie) is used instead. Production hosts
 * never accept ?org. The result only selects which
 * organization to sign into; access is always enforced by membership + RLS.
 */
export function resolveTenant(input: {
  host: string | null;
  orgParam: string | null;
  orgCookie: string | null;
}): TenantResolution {
  if (!input.host) return NONE;
  const hostname = hostnameOf(input.host);

  const fromSubdomain =
    subdomainSlug(hostname, ROOT_DOMAIN) ?? subdomainSlug(hostname, "localhost");
  if (fromSubdomain) return { slug: fromSubdomain, source: "subdomain", persist: false };

  if (!allowsOrgOverride(hostname)) return NONE;

  const fromQuery = validSlug(input.orgParam);
  if (fromQuery) return { slug: fromQuery, source: "query", persist: true };

  const fromCookie = validSlug(input.orgCookie);
  if (fromCookie) return { slug: fromCookie, source: "cookie", persist: false };

  return NONE;
}

/**
 * Absolute link to `path` in the tenant's app, e.g. for QR codes on printed
 * orders. Subdomain hosts carry the tenant; localhost and preview hosts get
 * ?org=<slug> so a phone opening the link lands in the right organization.
 */
export function tenantUrl(input: {
  host: string;
  protocol: string | null;
  slug: string;
  path: string;
}): string {
  const hostname = hostnameOf(input.host);
  const local =
    hostname === "localhost" || hostname.endsWith(".localhost") || developmentLanHost(hostname);
  const protocol = input.protocol === "http" || input.protocol === "https" ? input.protocol : null;
  const origin = `${protocol ?? (local ? "http" : "https")}://${input.host.trim().toLowerCase()}`;
  const url = new URL(input.path, origin);
  const fromSubdomain =
    subdomainSlug(hostname, ROOT_DOMAIN) ?? subdomainSlug(hostname, "localhost");
  if (fromSubdomain !== input.slug && allowsOrgOverride(hostname)) {
    url.searchParams.set("org", input.slug);
  }
  return url.toString();
}
