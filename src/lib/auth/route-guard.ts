// Decision of the proxy for one request (pure, so it is unit-testable).
// One active session per user (D-013): a signed-in request whose session was
// revoked by a newer sign-in elsewhere is signed out and sent to /login with a
// notice. A user with a temporary password (set by an administrator) is kept
// on /change-password until they choose their own.

// /support/enter redeems a one-time support token and /support/exit ends a
// support session (D-026, D-028); /registracija is the public company
// registration; /kiosk is the attendance tablet, which authenticates with
// its own device cookie (D-029).
export const SUPPORT_EXIT_PATH = "/support/exit";
/** Polled by the support banner; answers without redirects. */
export const SUPPORT_STATUS_PATH = "/support/status";
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/support/enter",
  SUPPORT_EXIT_PATH,
  SUPPORT_STATUS_PATH,
  "/registracija",
  "/kiosk",
]);

export const CHANGE_PASSWORD_PATH = "/change-password";

/** ?session=replaced on /login: explain why the user was signed out. */
export const SESSION_REPLACED_PARAM = { name: "session", value: "replaced" } as const;

export type RouteDecision =
  | { action: "next" }
  | {
      action: "redirect";
      to: "/login" | "/" | typeof CHANGE_PASSWORD_PATH | typeof SUPPORT_EXIT_PATH;
    }
  | { action: "sign_out"; to: "/login" };

export function decideRoute({
  path,
  signedInHere,
  sessionActive,
  mustChangePassword = false,
  supportEnded = false,
}: {
  path: string;
  /** JWT is valid and belongs to the tenant of this host. */
  signedInHere: boolean;
  /** The JWT's session still exists (only meaningful when signedInHere). */
  sessionActive: boolean;
  /** The user still has a temporary password (only meaningful when signedInHere). */
  mustChangePassword?: boolean;
  /** A support account whose approved session ended (only meaningful when signedInHere). */
  supportEnded?: boolean;
}): RouteDecision {
  // Ending a support session is handled by these two routes themselves, also
  // when its session was already revoked (D-028).
  if (path === SUPPORT_EXIT_PATH || path === SUPPORT_STATUS_PATH) return { action: "next" };
  // Back to the platform admin's own Zcore session, not the generic sign-out.
  if (signedInHere && supportEnded) return { action: "redirect", to: SUPPORT_EXIT_PATH };
  if (signedInHere && !sessionActive) return { action: "sign_out", to: "/login" };
  if (!signedInHere && !PUBLIC_PATHS.has(path)) return { action: "redirect", to: "/login" };
  if (signedInHere && mustChangePassword && path !== CHANGE_PASSWORD_PATH) {
    return { action: "redirect", to: CHANGE_PASSWORD_PATH };
  }
  if (signedInHere && path === "/login") return { action: "redirect", to: "/" };
  return { action: "next" };
}
