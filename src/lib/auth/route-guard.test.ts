import { describe, expect, it } from "vitest";
import { decideRoute } from "./route-guard";

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
