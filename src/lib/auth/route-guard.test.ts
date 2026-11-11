import { describe, expect, it } from "vitest";
import { decideRoute, isCronPath, needsSessionStatus } from "./route-guard";

describe("decideRoute", () => {
  it("lets an active session through and keeps it off /login", () => {
    expect(decideRoute({ path: "/machines", signedInHere: true, sessionActive: true })).toEqual({
      action: "next",
    });
    expect(decideRoute({ path: "/login", signedInHere: true, sessionActive: true })).toEqual({
      action: "redirect",
      to: "/",
    });
  });

  it("sends anonymous visitors of protected pages to /login", () => {
    expect(decideRoute({ path: "/floor", signedInHere: false, sessionActive: false })).toEqual({
      action: "redirect",
      to: "/login",
    });
    expect(decideRoute({ path: "/login", signedInHere: false, sessionActive: false })).toEqual({
      action: "next",
    });
  });

  it("opens the kiosk tablet page without a user login, but not its subpaths", () => {
    expect(decideRoute({ path: "/kiosk", signedInHere: false, sessionActive: false })).toEqual({
      action: "next",
    });
    expect(
      decideRoute({ path: "/kiosk/anything", signedInHere: false, sessionActive: false }),
    ).toEqual({ action: "redirect", to: "/login" });
  });

  it("signs out a session replaced by a sign-in on another device, on any path", () => {
    for (const path of ["/floor", "/login", "/machines"]) {
      expect(decideRoute({ path, signedInHere: true, sessionActive: false })).toEqual({
        action: "sign_out",
        to: "/login",
      });
    }
  });

  it("keeps a user with a temporary password on /change-password", () => {
    for (const path of ["/floor", "/login", "/machines", "/"]) {
      expect(
        decideRoute({ path, signedInHere: true, sessionActive: true, mustChangePassword: true }),
      ).toEqual({ action: "redirect", to: "/change-password" });
    }
    expect(
      decideRoute({
        path: "/change-password",
        signedInHere: true,
        sessionActive: true,
        mustChangePassword: true,
      }),
    ).toEqual({ action: "next" });
  });

  it("signs out a replaced session even with a temporary password", () => {
    expect(
      decideRoute({
        path: "/floor",
        signedInHere: true,
        sessionActive: false,
        mustChangePassword: true,
      }),
    ).toEqual({ action: "sign_out", to: "/login" });
  });

  it("sends anonymous visitors of /change-password to /login", () => {
    expect(
      decideRoute({ path: "/change-password", signedInHere: false, sessionActive: false }),
    ).toEqual({ action: "redirect", to: "/login" });
  });

  it("sends an ended support session to /support/exit even after its session was revoked", () => {
    expect(
      decideRoute({
        path: "/dashboard",
        signedInHere: true,
        sessionActive: false,
        supportEnded: true,
      }),
    ).toEqual({ action: "redirect", to: "/support/exit" });
    expect(
      decideRoute({ path: "/support/status", signedInHere: true, sessionActive: false }),
    ).toEqual({ action: "next" });
  });

  it("sends an ended support session to /support/exit", () => {
    for (const path of ["/dashboard", "/orders", "/login"]) {
      expect(
        decideRoute({ path, signedInHere: true, sessionActive: true, supportEnded: true }),
      ).toEqual({ action: "redirect", to: "/support/exit" });
    }
    expect(
      decideRoute({
        path: "/support/exit",
        signedInHere: true,
        sessionActive: true,
        supportEnded: true,
      }),
    ).toEqual({ action: "next" });
    expect(
      decideRoute({ path: "/support/exit", signedInHere: false, sessionActive: false }),
    ).toEqual({ action: "next" });
    expect(
      decideRoute({
        path: "/support/status",
        signedInHere: true,
        sessionActive: true,
        supportEnded: true,
      }),
    ).toEqual({ action: "next" });
  });
});

describe("needsSessionStatus", () => {
  it("asks the database only on /login; requireMember enforces the rest", () => {
    expect(needsSessionStatus("/login")).toBe(true);
    for (const path of ["/", "/orders", "/floor", "/change-password", "/api/notifications"]) {
      expect(needsSessionStatus(path)).toBe(false);
    }
  });

  it("a replaced session reaches /login, where it is signed out", () => {
    // Other paths: the proxy lets the token through, requireMember redirects to /login.
    expect(decideRoute({ path: "/login", signedInHere: true, sessionActive: false })).toEqual({
      action: "sign_out",
      to: "/login",
    });
  });
});

describe("isCronPath", () => {
  it("lets the Vercel cron routes past the tenant and session gate", () => {
    expect(isCronPath("/api/cron/purge-organizations")).toBe(true);
    expect(isCronPath("/api/cron")).toBe(false);
    expect(isCronPath("/api/cronx/purge")).toBe(false);
    expect(isCronPath("/login")).toBe(false);
    expect(isCronPath("/x/api/cron/purge-organizations")).toBe(false);
  });
});
